import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// node-postgres sends each query in one round trip through Supabase's transaction pooler;
// Prisma's built-in pgbouncer mode needed ~4 round trips per query (≈370ms vs ≈60ms from Colombo).
// The build imports this file without connecting, so a missing DATABASE_URL must not throw here (Vercel env not yet set).
function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NEXT_PHASE !== "phase-production-build") console.error("DATABASE_URL is not set: add it to the environment (Vercel → Settings → Environment Variables).");
  const connectionString = (url ?? "").split("?")[0];
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 5) });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Prisma.TransactionClient;

// Posting transactions touch stock, money and commission together (spec §20.3).
export function posting<T>(fn: (tx: Tx) => Promise<T>, timeout = 20_000) {
  return db.$transaction(fn, { timeout, maxWait: 10_000 });
}
