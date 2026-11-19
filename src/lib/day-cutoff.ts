// Business time is Asia/Colombo (UTC+05:30, no DST).
const OFFSET = 330 * 60_000;

// The next moment the business clock reads `hhmm` ("02:00") strictly after `now`.
export function nextCutoff(hhmm: string, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  const local = new Date(now.getTime() + OFFSET);
  const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - OFFSET;
  return new Date(at > now.getTime() ? at : at + 86_400_000);
}
