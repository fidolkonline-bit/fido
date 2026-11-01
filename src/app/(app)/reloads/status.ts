export const RELOAD_STATUS: Record<string, [string, "ok" | "warn" | "err" | "muted"]> = {
  REQUESTED: ["Waiting for staff", "warn"], ACKNOWLEDGED: ["Acknowledged", "warn"], PROCESSING: ["Being done", "warn"], UNCERTAIN: ["Result uncertain", "err"],
  SUCCESSFUL: ["Successful", "ok"], FAILED: ["Failed", "muted"], CANCELLED: ["Cancelled", "muted"],
};
