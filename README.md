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

This database is the live one: demo data was cleared on 1 Nov 2026 (`SEED_DEMO` is for a throwaway database only).
To wipe rehearsal imports before the real cutover — business records go, setup and logins stay — back up first, then:

```bash
CLEAR_CONFIRM=clear-all-business-data npm run db:clear
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

## Installed app (PWA) and phone notifications

Fido installs as an app from the same URL on every platform — no app store:

| Device | How to install |
| --- | --- |
| Android (Chrome, Samsung Internet) | Tap **Install** on the banner, or ⋮ → *Install app* |
| iPhone / iPad (iOS 16.4+) | In Safari: Share → **Add to Home Screen**, then open Fido from the new icon |
| Windows / Mac (Chrome, Edge) | **Install** on the banner, or the install icon in the address bar; it then sits in Start / the taskbar / the Dock |

Each device has **Settings → This device**: install status, turn task notifications on/off, and the start-of-shift test
(alarm sound + a real push). The service worker (`public/sw.js`) shows an offline screen when there is no network and
turns pushes into notifications; it caches no pages or data — sales, stock and money always come live from the server.

**Phone notifications (Web Push)** reach a device even when Fido is closed: new tasks (reload requests, bus parcels,
reminders), the pre-ETA reminder and overdue escalations — to the same people the in-app alarm rings for. Each alert is
claimed once in `TaskPush`, sent right after the request (and swept again by `/api/cron`), and goes only to devices
whose login session is still open, so logging out of a shared device stops that person's alerts. To switch it on:

```bash
npx web-push generate-vapid-keys      # once; keep the private key secret
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@yourshop.lk` or the app URL — Apple
rejects a missing one) in Vercel and `.env.local`, apply the migration (`npm run db:deploy`), and redeploy. Until
both are done the app works as before and push stays off. Changing the keys later makes every device turn
notifications on again. iPhones only get notifications from the Home Screen app. The repeating alarm sound still
needs Fido open (browsers don't allow custom alarm sounds from a push); a closed app gets the phone's normal
notification sound.

## Code map

| Path | What |
| --- | --- |
| `src/lib/sales.ts` | POS finalize: price/discount limits, FIFO allocation, commission accrual, payments, idempotency |
| `src/lib/purchases.ts` | GRN posting: accepted qty → cost layer + movement; supplier payment kept separate |
| `src/lib/stock.ts` | Availability and row-locked FIFO allocation |
| `src/lib/debt.ts`, `debt-rules.ts` | Customer debt ledger, repayment receipts and allocation order (shared with the POS preview) |
| `src/lib/numbering.ts` | Concurrency-safe document numbers (`INV2026/0001`, `PO2026/0001`, …) |
| `src/lib/auth.ts` | DB-backed sessions (revocable), server-side permission guards |
| `src/lib/push.ts`, `src/lib/tasks.ts` | Web Push transport (VAPID, subscriptions per session) and the task alert sweep |
| `src/components/pwa/`, `public/sw.js`, `src/app/manifest.ts` | Installed app: install prompt, This device settings, service worker, manifest |
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

**POS lot choice and price tiers:**
- The salesperson picks the lot actually handed over (lot, GRN / source, location, available). One eligible lot is
  preselected; several must be chosen. A short lot shows the shortage and can be split across lots explicitly — never
  topped up silently. Phones are chosen by IMEI with their lot and GRN shown. Lots are locked and rechecked at
  completion; each lot keeps its own original cost (the costing policy is unchanged).
- Selling-price tiers are configuration (Settings › Selling price tiers): create, rename, describe, order,
  (de)activate, and choose which roles may pick each tier. Prices, customer groups and sales link by id; a tier used
  by a sale can only be deactivated. Five tiers were seeded from the old system.
- Product × tier price matrix on each product (and as columns named after the tier in the product import). Empty =
  default price with a visible fallback note; a legacy 0 is not treated as free until confirmed.
- Customer groups pick a tier or a % on the default price. The POS shows customer and tier together; an override needs
  `pricing.tier_override` and role access. Changing customer or tier previews the new prices — Apply or Cancel — and
  keeps lots, devices and quantities. Sales store the price rule, rule price and tier name as sold.
  The preview shows the subtotal difference and the discounts affected; a tier picked by hand is not carried over
  to another customer. Scanning an internal lot label that names one saleable lot here preselects that lot.

**Customer debt at the POS (change sheet 01, CR-03):**
- Customer search by name, mobile or customer ID; results show a masked mobile and the ID, and several matches are
  listed for the cashier to pick. The selected customer shows previous debt, the overdue part (from pay terms) and
  advance / store credit separately, loaded live ("Loading balance" / "Balance unavailable", never a false 0).
- Previous debt and the current sale are labelled apart; debt is never added to the cart. Receive payment opens over
  the POS and leaves the cart as it is (it also works with an empty cart): amount blank, Pay full debt, method,
  receiving account (default for the method / this register), paid-on date, reference / note / cheque details.
- Proposed allocation (not legacy behaviour): oldest due date first, the opening balance counting its reference
  date; invoices without a due date after dated ones, by date. Change allocation needs `debt.allocate`.
- More than the debt must be kept as advance credit or (cash only) given back as change. Store credit can be applied
  to debt explicitly. A cheque settles only the debt, shows as pending, and a bounce puts the debt back.
- One receipt (`RCP2026/0001`) = one money movement (cash to the register, card/bank to its account) plus its
  allocations, committed together under a lock on the customer. No sale, stock movement, revenue or commission.
  A changed balance (competing payment or return) is refused until the new allocation is reviewed; retries return
  the same receipt; after a timeout the POS checks the receipt status before collecting again.
- Print / SMS receipt after posting (SMS failure never touches the payment). Debt payments list, RP-37 Customer debt
  collections, receipts in RP-15 / RP-22 / RP-23, the customer page and the invoice. Opening balances are paid down
  (`Contact.openingPaid`), so every debt figure (lists, RP-17, RP-24, credit limit) nets them off.
- Permissions: `debt.view`, `debt.receive` (Cashier has both), `debt.allocate`, `debt.account`, `debt.backdate`,
  `debt.reverse` (Manager, Owner). Corrections are linked reversals; the receipt stays, marked reversed.

Before the first live payroll: set up EPF/ETF, tax and any overtime / holiday-pay rules as pay components and
check them against approved sample payslips (spec §26).

Server job: `/api/cron` (reminders, task escalation, recurring expenses, subscriptions, SMS retries). Vercel Hobby
allows only daily cron, so `vercel.json` runs it once a day (00:30 UTC) and Supabase pg_cron calls it every minute:

```bash
scripts/setup-supabase-cron.sh https://<your-app>.vercel.app   # re-run if the URL or CRON_SECRET changes
```

Set the same `CRON_SECRET` in Vercel. Open shop devices also run reminders and escalations on their 15-second poll.
Functions are pinned to Mumbai (`bom1`). Vercel Hobby is for non-commercial use; Pro removes both limits.

Hardware gates before live use (spec §26): print on the real receipt and label printers, scan printed labels
with the shop's scanners, and check Sinhala/Tamil text on printed output. Test the staff alarm on the actual shop
phones (sound, vibration, notification permission, screen locked/unlocked) and send a real Text.lk SMS.
