// Base setup for a fresh database. Safe to re-run (upserts).
//   npm run db:seed              → business, location, roles, owner login, accounts, units, categories
//   SEED_DEMO=1 npm run db:seed  → also sample supplier, products and opening stock for trying the POS
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { appendFileSync, readFileSync } from "fs";
import { DEFAULT_ROLES } from "../src/lib/permissions";

const db = new PrismaClient();

// Observed category examples (spec §9.1): pool rate with user/agent shares of the pool.
const CATEGORIES = [
  { name: "Back Covers", poolRate: 0.09, userShare: 2 / 9, agentShare: 7 / 9 },
  { name: "Chargers", poolRate: 0.04, userShare: 0.25, agentShare: 0.75 },
  { name: "Smartphones", poolRate: 0.01, userShare: 0.2, agentShare: 0.8 },
  { name: "Android phones", poolRate: 0.008, userShare: 0.125, agentShare: 0.875 },
];

async function main() {
  const business =
    (await db.business.findFirst()) ??
    (await db.business.create({ data: { name: "Fido", currency: "LKR", timeZone: "Asia/Colombo", saleRounding: 0.5 } }));

  const main = await db.location.upsert({
    where: { code: "MAIN" },
    update: {},
    create: { businessId: business.id, code: "MAIN", name: "Main shop" },
  });

  for (const r of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { name: r.name },
      update: r.name === "Owner/Admin" ? { permissions: r.permissions } : {},
      create: { name: r.name, description: r.description, permissions: r.permissions, system: true },
    });
  }
  const ownerRole = await db.role.findUniqueOrThrow({ where: { name: "Owner/Admin" } });

  const username = (process.env.ADMIN_USERNAME ?? "owner").toLowerCase();
  if (!(await db.loginAccount.findUnique({ where: { username } }))) {
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      password = randomBytes(9).toString("base64url");
      // Keep the generated owner password out of the terminal: store it in the git-ignored env file.
      const env = readFileSync(".env.local", "utf8");
      appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}\n# First owner login created by db:seed — change it after signing in\nADMIN_USERNAME="${username}"\nADMIN_PASSWORD="${password}"\n`);
    }
    const person = await db.person.create({ data: { fullName: "Shop Owner" } });
    const acct = await db.loginAccount.create({
      data: { personId: person.id, username, passwordHash: await bcrypt.hash(password, 10), roleId: ownerRole.id, maxDiscountPct: 100 },
    });
    await db.userLocation.create({ data: { accountId: acct.id, locationId: main.id } });
    await db.commissionProfile.create({ data: { personId: person.id, kind: "USER" } });
    console.log(`Owner login "${username}" created. Password is in .env.local (ADMIN_PASSWORD).`);
  }

  const accounts = [
    { name: "Main shop till", type: "CASH", locationId: main.id },
    { name: "Card settlements", type: "CARD", locationId: null },
    { name: "Business bank", type: "BANK", locationId: null },
    { name: "Owner collection", type: "OWNER_COLLECTION", locationId: null },
  ];
  for (const a of accounts) await db.account.upsert({ where: { name: a.name }, update: {}, create: a });

  await db.unit.upsert({ where: { name: "Pieces" }, update: {}, create: { name: "Pieces", shortName: "Pc(s)" } });
  for (const w of [{ name: "No warranty", durationDays: 1 }, { name: "6 months", durationDays: 182 }, { name: "1 year", durationDays: 365 }]) {
    await db.warranty.upsert({ where: { name: w.name }, update: {}, create: w });
  }
  for (const c of CATEGORIES) {
    if (!(await db.category.findFirst({ where: { name: c.name } }))) await db.category.create({ data: c });
  }

  for (const name of ["Transport", "Utilities", "Rent", "Shop supplies", "Repairs & maintenance", "Food & refreshments", "Other"]) {
    await db.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  }

  // Observed catalog rates (spec §10): money paid per 1.00 nominal. Edit under Reloads → Wallets if the provider terms differ.
  for (const w of [
    { name: "Dialog reload", networks: ["DIALOG"], costRate: 0.96 },
    { name: "Mobitel reload", networks: ["MOBITEL"], costRate: 0.96 },
    { name: "Hutch reload", networks: ["HUTCH"], costRate: 0.94 },
    { name: "Airtel reload", networks: ["AIRTEL"], costRate: 1 },
  ]) await db.reloadWallet.upsert({ where: { name: w.name }, update: {}, create: { ...w, locationId: main.id } });

  // HR masters. Leave types as observed in the old system (§14.1); caps are company settings, not statutory rules.
  for (const name of ["Shop operations", "Repairs"]) await db.department.upsert({ where: { name }, update: {}, create: { name } });
  for (const name of ["Salesperson", "Cashier", "Technician", "Manager"]) await db.designation.upsert({ where: { name }, update: {}, create: { name } });
  for (const t of [
    { name: "CASUAL LEAVE", maxCount: 2, interval: "MONTH", paid: true },
    { name: "Other", maxCount: 2, interval: "NONE", paid: true },
    { name: "Sunday", maxCount: 5, interval: "NONE", paid: true },
    { name: "Unpaid leave", maxCount: null, interval: "NONE", paid: false },
  ]) await db.leaveType.upsert({ where: { name: t.name }, update: {}, create: t });
  await db.shift.upsert({ where: { name: "Day shift" }, update: {}, create: { name: "Day shift", startTime: "09:00", endTime: "18:00", graceMinutes: 10, restDays: [0] } });

  if (process.env.SEED_DEMO === "1") await demo(main.id);
}

async function demo(locationId: string) {
  const owner = await db.person.findFirstOrThrow({ where: { login: { isNot: null } }, orderBy: { createdAt: "asc" } });
  const supplier =
    (await db.contact.findFirst({ where: { name: "Demo Accessories Supplier" } })) ??
    (await db.contact.create({ data: { name: "Demo Accessories Supplier", isCustomer: false, isSupplier: true, phone: "0770000000" } }));
  if (!(await db.contact.findFirst({ where: { name: "Demo Customer" } })))
    await db.contact.create({ data: { name: "Demo Customer", phone: "0711111111", creditLimit: 10000 } });
  if (!(await db.person.findFirst({ where: { fullName: "Demo Referral Agent" } }))) {
    const agent = await db.person.create({ data: { fullName: "Demo Referral Agent" } });
    await db.commissionProfile.create({ data: { personId: agent.id, kind: "AGENT" } });
  }
  const unit = await db.unit.findUniqueOrThrow({ where: { name: "Pieces" } });
  const cat = async (name: string) => (await db.category.findFirstOrThrow({ where: { name } })).id;

  const items = [
    { sku: "D-101", name: "Phone back cover", category: "Back Covers", price: 1000, cost: 400, lots: [["BATCH-A", 10, 400], ["BATCH-B", 10, 450]] },
    { sku: "D-102", name: "Fast charger 25W", category: "Chargers", price: 1500, cost: 700, lots: [["XMT9225", 8, 700]] },
    { sku: "D-103", name: "USB-C cable 1m", category: "Chargers", price: 800, cost: 250, lots: [["BATCH-D", 15, 250]] },
  ] as const;

  for (const it of items) {
    if (await db.product.findUnique({ where: { sku: it.sku } })) continue;
    const p = await db.product.create({
      data: { sku: it.sku, name: it.name, categoryId: await cat(it.category), unitId: unit.id, sellPrice: it.price, defaultCost: it.cost, alertQty: 3 },
    });
    // Opening stock uses the same cost-layer + movement model as receiving (spec §6.3).
    for (const [lot, q, cost] of it.lots) {
      const layer = await db.costLayer.create({
        data: { productId: p.id, locationId, lotCode: lot, qtyIn: q, qtyRemaining: q, unitCost: cost, receivedAt: new Date() },
      });
      await db.stockMovement.create({
        data: { productId: p.id, locationId, costLayerId: layer.id, qty: q, unitCost: cost, kind: "OPENING", sourceType: "Opening", sourceId: layer.id, reference: `OPENING-${lot}`, actorId: owner.id },
      });
    }
  }
  console.log(`Demo data ready (supplier: ${supplier.name}).`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
