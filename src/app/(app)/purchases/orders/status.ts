export const PO_STATUS: Record<string, [string, "ok" | "warn" | "err" | "muted"]> = {
  ORDERED: ["Ordered", "warn"], PART_RECEIVED: ["Part received", "warn"], RECEIVED: ["Received", "ok"], CLOSED: ["Closed short", "muted"], CANCELLED: ["Cancelled", "muted"],
};
