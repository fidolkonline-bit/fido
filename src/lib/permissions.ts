// Permission keys checked on the server for every read/write (spec §4.2).
export const PERMISSIONS = {
  "users.manage": "Manage users and roles",
  "settings.manage": "Business settings and locations",
  "contacts.view": "View customers and suppliers",
  "contacts.manage": "Create and edit contacts",
  "products.view": "View products and stock",
  "products.manage": "Create and edit products and catalog masters",
  "cost.view": "See purchase costs and profit",
  "purchases.view": "View purchases / GRNs",
  "purchases.post": "Receive goods, post GRNs and raise purchase orders",
  "purchases.claims": "Supplier returns, claims and recovery",
  "imports.run": "Import products and opening stock",
  "sales.view": "View sales history",
  "sales.create": "Sell at POS",
  "sales.override_price": "Override price and discount limits",
  "sales.credit_override": "Sell beyond customer credit limit",
  "returns.create": "Process sell returns, refunds and exchanges",
  "stock.adjust": "Stock adjustments, write-offs and hold releases",
  "stock.transfer": "Send and receive stock transfers",
  "expenses.view": "View expenses",
  "expenses.manage": "Record and pay expenses",
  "register.operate": "Open and close own cash register",
  "register.review": "Review all registers",
  "accounts.view": "View payment accounts",
  "accounts.manage": "Create payment accounts",
  "reports.view": "View reports",
  "repairs.view": "View repair jobs",
  "repairs.manage": "Take in, update and bill repairs",
  "repairs.credentials": "See a repair job's PIN / pattern",
  "reloads.request": "Request remote reloads (owner)",
  "reloads.process": "Carry out reloads and record the result",
  "reloads.wallets": "Fund and reconcile reload wallets",
  "tasks.manage": "Assign staff tasks and bus parcels; see everyone's tasks",
  "notifications.manage": "SMS templates and sending",
  "hr.view": "See staff profiles, attendance and leave of the team",
  "hr.manage": "Edit employees, holidays, leave types, shifts and pay components",
  "hr.payroll": "Calculate, approve and pay payroll",
  "hr.bank": "See and edit staff bank details",
  "leave.approve": "Approve or reject leave",
  "attendance.manage": "Correct clock-in/out records",
  "commissions.manage": "Approve and pay sales commission",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

// New defaults, not a copy of the legacy Cashier role's broad rights.
export const DEFAULT_ROLES: { name: string; description: string; permissions: Permission[] }[] = [
  { name: "Owner/Admin", description: "All locations and settings", permissions: ALL_PERMISSIONS },
  {
    name: "Manager",
    description: "Assigned locations, review and approvals",
    permissions: [
      "contacts.view", "contacts.manage", "products.view", "products.manage", "cost.view",
      "purchases.view", "purchases.post", "sales.view", "sales.create", "sales.override_price",
      "sales.credit_override", "register.operate", "register.review", "accounts.view", "reports.view",
      "returns.create", "stock.adjust", "stock.transfer", "expenses.view", "expenses.manage", "purchases.claims", "imports.run",
      "repairs.view", "repairs.manage", "repairs.credentials", "reloads.request", "reloads.process", "reloads.wallets", "tasks.manage",
      "hr.view", "leave.approve", "attendance.manage",
    ],
  },
  {
    name: "Cashier",
    description: "POS and register at assigned locations",
    permissions: ["contacts.view", "contacts.manage", "products.view", "sales.view", "sales.create", "register.operate", "repairs.view", "repairs.manage", "reloads.process"],
  },
  {
    name: "Stock clerk",
    description: "Receiving and stock handling",
    permissions: ["contacts.view", "products.view", "products.manage", "cost.view", "purchases.view", "purchases.post", "stock.adjust", "stock.transfer", "purchases.claims"],
  },
  { name: "Technician", description: "Assigned repairs", permissions: ["products.view", "repairs.view", "repairs.manage", "repairs.credentials"] },
  { name: "HR/Payroll", description: "People and payroll", permissions: ["hr.view", "hr.manage", "hr.payroll", "hr.bank", "leave.approve", "attendance.manage", "commissions.manage"] },
  { name: "Agent", description: "Own referrals and commission", permissions: [] },
];

export const can = (user: { permissions: Set<string> }, p: Permission) => user.permissions.has(p);
