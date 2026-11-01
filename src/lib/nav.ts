import type { Permission } from "./permissions";

// Familiar top-level order (spec §2.2), with Reloads and Staff Tasks added. No WooCommerce.
// `phase` marks screens not yet built; they open a status page instead of a fake table.
export type NavItem = { label: string; href: string; perm?: Permission; phase?: string };
export type NavGroup = { key: string; label: string; items: NavItem[]; isNew?: boolean };

const soon = (label: string, slug: string, phase: string): NavItem => ({ label, href: `/planned/${slug}`, phase });

export const NAV: NavGroup[] = [
  {
    key: "users", label: "User Management",
    items: [
      { label: "Users", href: "/users", perm: "users.manage" },
      { label: "Roles", href: "/users/roles", perm: "users.manage" },
    ],
  },
  {
    key: "contacts", label: "Contacts",
    items: [
      { label: "Customers", href: "/contacts?type=customer", perm: "contacts.view" },
      { label: "Suppliers", href: "/contacts?type=supplier", perm: "contacts.view" },
      { label: "Customer groups", href: "/contacts/groups", perm: "contacts.manage" },
    ],
  },
  {
    key: "products", label: "Products",
    items: [
      { label: "Products", href: "/products", perm: "products.view" },
      { label: "Lots & stock ledger", href: "/products/lots", perm: "products.view" },
      { label: "Categories & commission", href: "/products/categories", perm: "products.manage" },
      { label: "Brands, units, warranties", href: "/products/masters", perm: "products.manage" },
      { label: "Phone / device identities", href: "/products/devices", perm: "products.view" },
      { label: "Print labels", href: "/products/labels", perm: "products.view" },
      { label: "Imports & opening stock", href: "/products/imports", perm: "imports.run" },
    ],
  },
  {
    key: "repair", label: "Repair",
    items: [{ label: "Repair queue", href: "/repairs", perm: "repairs.view" }, { label: "New repair job", href: "/repairs/new", perm: "repairs.manage" }],
  },
  {
    key: "purchases", label: "Purchases",
    items: [
      { label: "Receive goods / GRN", href: "/purchases", perm: "purchases.view" },
      { label: "Purchase orders", href: "/purchases/orders", perm: "purchases.view" },
      { label: "Supplier returns / recovery", href: "/purchases/returns", perm: "purchases.view" },
    ],
  },
  {
    key: "sell", label: "Sell",
    items: [
      { label: "POS", href: "/pos", perm: "sales.create" },
      { label: "All sales", href: "/sales", perm: "sales.view" },
      { label: "Sell Return / Exchange", href: "/returns", perm: "sales.view" },
      { label: "Quotes & suspended sales", href: "/sales/drafts", perm: "sales.view" },
      { label: "Subscriptions", href: "/sales/subscriptions", perm: "sales.create" },
      { label: "Shipments", href: "/sales/shipments", perm: "sales.view" },
      { label: "Discount rules", href: "/sales/discounts", perm: "products.manage" },
    ],
  },
  { key: "transfers", label: "Stock Transfers", items: [{ label: "Stock transfers", href: "/transfers", perm: "products.view" }] },
  { key: "adjustments", label: "Stock Adjustment", items: [{ label: "Stock adjustments", href: "/adjustments", perm: "products.view" }] },
  { key: "expenses", label: "Expenses", items: [{ label: "Expenses", href: "/expenses", perm: "expenses.view" }, { label: "Recurring expenses", href: "/expenses/recurring", perm: "expenses.manage" }] },
  {
    key: "accounts", label: "Payment Accounts",
    items: [
      { label: "Payment accounts", href: "/accounts", perm: "accounts.view" },
      { label: "Cash register", href: "/register", perm: "register.operate" },
      { label: "Cheques", href: "/accounts/cheques", perm: "accounts.view" },
    ],
  },
  { key: "reports", label: "Reports", items: [{ label: "Reports", href: "/reports", perm: "reports.view" }] },
  { key: "notifications", label: "Notification Templates", items: [{ label: "SMS log & templates", href: "/notifications", perm: "notifications.manage" }] },
  {
    key: "settings", label: "Settings",
    items: [
      { label: "Business & locations", href: "/settings", perm: "settings.manage" },
      { label: "Numbering", href: "/settings/numbering", perm: "settings.manage" },
      { label: "Invoice layouts & printers", href: "/settings/printing", perm: "settings.manage" },
      { label: "Label sizes", href: "/settings/labels", perm: "settings.manage" },
      soon("Tax / service / modifiers", "tax", "D"),
    ],
  },
  {
    key: "hrm", label: "HRM",
    items: [
      { label: "People desk", href: "/hrm" },
      { label: "My attendance & leave", href: "/hrm/me" },
      { label: "Attendance", href: "/hrm/attendance", perm: "hr.view" },
      { label: "Leave", href: "/hrm/leave", perm: "hr.view" },
      { label: "Employees", href: "/hrm/employees", perm: "hr.view" },
      { label: "Holidays", href: "/hrm/holidays", perm: "hr.view" },
      { label: "Payroll", href: "/hrm/payroll", perm: "hr.payroll" },
      { label: "Commission payout", href: "/hrm/commissions", perm: "commissions.manage" },
      { label: "HR setup", href: "/hrm/setup", perm: "hr.manage" },
      { label: "Sales targets", href: "/hrm/targets", perm: "hr.payroll" },
    ],
  },

  {
    key: "essentials", label: "Essentials",
    items: [
      { label: "Noticeboard", href: "/essentials" },
      { label: "Messages", href: "/essentials/messages" },
      { label: "Reminders", href: "/essentials/reminders" },
      { label: "Knowledge base", href: "/essentials/knowledge" },
      { label: "Documents", href: "/essentials/documents" },
      { label: "To Do (staff tasks)", href: "/tasks" },
    ],
  },

  { key: "reloads", label: "Reloads", isNew: true, items: [{ label: "Reloads & wallets", href: "/reloads", perm: "reloads.process" }, { label: "New reload", href: "/reloads/new", perm: "reloads.process" }] },
  { key: "tasks", label: "Staff Tasks", items: [{ label: "Task inbox", href: "/tasks" }, { label: "Bus parcels", href: "/tasks?tab=parcels" }] },
];

export const PHASE_LABEL: Record<string, string> = {
  B: "Phase B · Stock and trade",
  C: "Phase C · Repairs and remote operations",
  D: "Phase D · People and remaining modules",
};
