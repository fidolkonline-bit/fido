// Clears every business record and keeps the setup: business, locations, roles, logins (and their people and
// sessions), payment accounts, units, warranties, expense categories, HR masters, numbering, templates, reload wallets,
// price tiers and their role access.
// Used to remove demo data and, later, rehearsal imports before the real cutover (spec §22).
//
//   CLEAR_CONFIRM=clear-all-business-data npm run db:clear
//
// Take a backup first. Nothing here can be undone.
import { PrismaClient } from "@prisma/client";

const KEEP = [
  "Business", "Location", "Role", "Person", "LoginAccount", "Session", "UserLocation", "CommissionProfile", "Account", "AppSetting",
  "Unit", "Warranty", "ExpenseCategory", "Department", "Designation", "LeaveType", "Shift", "NumberScheme", "NotificationTemplate",
  "ReloadWallet", "PriceGroup", "PriceGroupAccess", "_prisma_migrations",
];

async function main() {
  if (process.env.CLEAR_CONFIRM !== "clear-all-business-data") {
    console.error("Refusing to run. Set CLEAR_CONFIRM=clear-all-business-data after taking a backup.");
    process.exit(1);
  }
  const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
  const tables = (await db.$queryRaw<{ t: string }[]>`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`).map((r) => r.t).filter((t) => !KEEP.includes(t));
  // A kept table must never point at a cleared one, or TRUNCATE … CASCADE would empty it too.
  const unsafe = await db.$queryRaw<{ k: string }[]>`
    SELECT trim(both '"' from conrelid::regclass::text) AS k FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      AND trim(both '"' from conrelid::regclass::text) = ANY(${KEEP})
      AND NOT (trim(both '"' from confrelid::regclass::text) = ANY(${KEEP}))`;
  if (unsafe.length) throw new Error(`Kept tables reference cleared ones: ${unsafe.map((u) => u.k).join(", ")}. Update KEEP.`);

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
    // People without a login are agents and staff records: business data. Logins and their people stay.
    await tx.$executeRaw`DELETE FROM "CommissionProfile" WHERE "personId" NOT IN (SELECT "personId" FROM "LoginAccount")`;
    await tx.$executeRaw`DELETE FROM "Person" WHERE id NOT IN (SELECT "personId" FROM "LoginAccount")`;
    // Balances restart from the cut-over openings; numbering is set to follow on from the old system afterwards.
    await tx.$executeRaw`UPDATE "Account" SET "openingBalance" = 0`;
    await tx.$executeRaw`UPDATE "NumberScheme" SET "nextValue" = 1`;
  }, { timeout: 120_000 });
  console.log(`Cleared ${tables.length} tables. Kept: ${KEEP.filter((t) => t !== "_prisma_migrations").join(", ")}.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
