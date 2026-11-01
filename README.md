# Fido Operations System

Replacement for the shop's Clicky POS. Build spec: [SPECIFICATION.md](SPECIFICATION.md). The original
clickable design prototype lives in [design/](design/).

**Deploying to Vercel:** set the function region to Mumbai (`bom1`) so it sits next to the database; from the US region every query would cross an ocean.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · Prisma 6 · Supabase Postgres (ap-south-1) · deploys to Vercel.

## Run locally

```bash
npm install
npm run dev            # http://localhost:3000
```

`.env.local` (git-ignored) holds the Supabase connection strings — see `.env.example`:

| Variable | Supabase connection | Used for |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler, port 6543 | App runtime, via `@prisma/adapter-pg` (one round trip per query) |
| `DIRECT_URL` | Session pooler, port 5432 | Migrations |

Optional `DB_POOL_MAX` (default 5) sets connections per server instance. Percent-encode special characters in the database password (`/` → `%2F`, `@` → `%40`).

## Database

```bash
npm run db:deploy      # apply committed migrations
npm run db:seed        # business, Main shop, roles, owner login, accounts, units, categories
SEED_DEMO=1 npm run db:seed   # + demo supplier/products/opening stock
npm run db:studio      # browse data
```

The first seed creates the owner login and writes its password to `.env.local` (`ADMIN_PASSWORD`). Change it
after signing in (Settings → Change my password).

**Creating a migration** (there is no separate shadow database — never point a shadow URL at the live DB):

```bash
# 1. edit prisma/schema.prisma
# 2. generate SQL by diffing the live schema (read-only) against the new model
mkdir prisma/migrations/$(date +%Y%m%d%H%M%S)_describe_change
npx dotenv -e .env.local -- prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<that folder>/migration.sql
# 3. review the SQL, then
npm run db:deploy
```

New tables must also get `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — every app table is locked away from
Supabase's public REST API; the app reaches Postgres only through Prisma.

## Code map

| Path | What |
| --- | --- |
| `src/lib/sales.ts` | POS finalize: price/discount limits, FIFO allocation, commission accrual, payments, idempotency |
| `src/lib/purchases.ts` | GRN posting: accepted qty → cost layer + movement; supplier payment kept separate |
| `src/lib/stock.ts` | Availability and row-locked FIFO allocation |
| `src/lib/numbering.ts` | Concurrency-safe document numbers (`INV2026/0001`, `PO2026/0001`, …) |
| `src/lib/auth.ts` | DB-backed sessions (revocable), server-side permission guards |
| `src/lib/permissions.ts` | Permission keys and default roles |
| `src/lib/reports/` | Report definitions (`sales`, `stock`, `money`, `ops`), filters, CSV |
| `src/lib/imports.ts` | CSV dry run / commit for products, opening stock, contacts, categories |
| `src/lib/nav.ts` | Full navigation; unbuilt screens are marked with their delivery phase |
| `src/app/(app)/…` | Screens (each route folder = one screen family) |

## Status

**Phase A:** login/sessions/roles, users & agents, customers/suppliers with dues, products, categories with
commission split, brands/units/warranties, lots & stock ledger, receive goods (GRN), POS with split
payments/credit/rounding/commission, sales history and receipts, cash register with denomination count,
payment accounts, first reports, settings.

**Phase B (complete):**
- Sell Return / Exchange — credit notes against original sale lines; debt offset first, then cash/card refund or
  store credit; per-item disposition (saleable original lot, inspection hold, supplier hold, write-off);
  commission reversal; "Sell replacement" opens POS with the customer's store credit.
- IMEI / serial devices — captured per unit on GRN, sold/returned/moved by exact device, device register.
- Stock adjustments — write-off at original lot cost, found stock, release of held stock.
- Stock transfers — dispatch with lot/cost/FIFO date, receive at destination with shortfall tracking.
- Expenses — categories, paid now or due, later payments; cash expenses reduce the register's expected cash.

- Purchase orders — no stock until received; GRNs received against an order, over-receipt blocked, close/cancel.
- Supplier returns / recovery — goods leave stock when sent; credit, refund, replacement and rejection recorded
  once, with the loss worked out; supplier credit reduces the payable.
- Imports — products and opening stock (by lot, cost and IMEI) from CSV, dry run with row errors, commit valid rows.
- Numbering (forward-only sequences), invoice/receipt layout (80 mm, 58 mm, A4), printer profiles per location,
  Code 128 barcodes on receipts and stock labels (roll or A4 sheet).

**Phase C (complete):**
- Repairs — intake with checklist, PIN / drawn pattern encrypted (AES-256-GCM, `CREDENTIAL_KEY`), reveal only with
  permission and logged, deleted at handover; diagnosis/estimate/approval, parts issued and returned by lot,
  labour/charges, deposits and payments, no handover with balance due; job sticker (barcode = job number only) and bill.
- Reloads — wallets per channel with cost rate, funding ledger, counter reloads and owner remote requests;
  claim → result; one success = one sale + one wallet deduction; uncertain results block re-reloading that number.
- Staff tasks & bus parcels — alarm on every signed-in device (15 s polling, repeating sound, phone notification),
  explicit acknowledgement, pre-ETA reminder, escalation after 5 min with SMS fallback; collected ≠ stock until
  checked contents are received through a GRN.
- SMS — Text.lk adapter, outbox with duplicate protection, NOT_CONFIGURED / FAILED / UNKNOWN states, controlled
  resend, editable templates, receipt / repair / reload messages.

**Phase D1 (complete):**
- Employees — profiles separate from logins (agents never enter payroll), departments/designations, shifts,
  effective-dated salary history, bank account encrypted and visible only with the bank permission.
- Holidays and leave — holidays per location, leave types with caps per month/year, working-day counting,
  overlap and cap checks, approval by someone else, cancellation.
- Attendance — phone clock in/out on server time, late / missing clock-out / absent / rest-day work flags,
  corrections only as added or voided events with a reason.
- Payroll — draft runs recalculated from snapshots, unpaid-leave proration, fixed / % components, manual lines
  with reasons, approval locks payslips, part/full payments, printable payslips (own payslip only for staff).
- Commission payout — approve, then pay directly or via payroll; each commission line is settled exactly once.

**Phase D2 (complete):**
- Later payments on credit sales and supplier GRNs; cheque register (deposit / clear / bounce / cancel) — a
  bounce reverses the payment once and puts the debt back on the original sale, bill, expense or payslip.
- Quotes and suspended sales (no stock, no money) resumed at the POS; subscriptions create one draft invoice per
  period; recurring expenses create one due expense per occurrence.
- Discount rules (one best offer, never stacked; allowed beyond the cashier's own limit only for the offer amount).
- Shipments with COD — delivered is not paid until the remittance is recorded.
- Sales targets (flat / progressive bands) paid once through payroll, separate from commission.
- Essentials: noticeboard, reminders that ring as tasks, private staff messages, knowledge base with revisions,
  documents (≤ 4 MB, role-restricted downloads).

**Phase E (complete):**
- Reports — all 36 (RP-01 … RP-36) in one catalogue at `/reports`, each with its basis stated, period and
  location filters, totals over every row, drill-through to the source document, CSV export and print. Cost
  columns are removed on the server for users without cost permission (screen and CSV alike).
- Profit / Loss counts each thing once: net sales − lot COGS + repair margin − expenses − payroll − commission −
  targets − wastage − supplier-claim losses. Stock, receivables/payables and commission figures agree across
  reports (checked by script).
- Migration — CSV imports for customers/suppliers (codes, groups, credit limits, opening balances) and categories
  with commission rates (legacy ids kept; share totals other than 100% imported as-is and flagged), alongside the
  product and opening-stock imports. Cutover checklist (`/products/imports/cutover`): data loaded, figures to
  reconcile with Clicky, items to investigate, next document numbers, go-live gates.
- Waiting on Clicky: full sales/purchase history import needs a real export or read-only database access.
- Clicky exports upload as they are (products, customers, suppliers, users): converted in the browser into the
  import templates, with findings shown before the dry run — reload items kept out of stock, reused SKUs suffixed,
  advances to store credit, agent + cashier records of one person merged, vendor accounts left out. Opening stock
  is placed by location name, so Clicky's locations must exist (or be renamed to match) first.

Before the first live payroll: set up EPF/ETF, tax and any overtime / holiday-pay rules as pay components and
check them against approved sample payslips (spec §26).

Server job: `vercel.json` runs `/api/cron` every minute (escalations + SMS) and pins functions to Mumbai (`bom1`).
Per-minute cron needs a paid Vercel plan; set `CRON_SECRET` in Vercel.

Hardware gates before live use (spec §26): print on the real receipt and label printers, scan printed labels
with the shop's scanners, and check Sinhala/Tamil text on printed output. Test the staff alarm on the actual shop
phones (sound, vibration, notification permission, screen locked/unlocked) and send a real Text.lk SMS.
