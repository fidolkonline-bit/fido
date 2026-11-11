// IMEI rules shared by receiving, imports, trade-ins and repairs. Pure: no database access.
// 15 digits = IMEI with a Luhn check digit (validated). 14 = IMEI without check digit, 16–17 = IMEISV (format only).

export function luhnOk(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

// Returns a message when the IMEI is wrong, otherwise null.
export function imeiProblem(raw: string | null | undefined, label = "IMEI"): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!/^\d{14,17}$/.test(v)) return `${label} must be 14–17 digits.`;
  if (/^(\d)\1+$/.test(v)) return `${label} ${v} is not a real IMEI.`;
  if (v.length === 15 && !luhnOk(v)) return `${label} ${v} fails the check digit — one digit is probably mistyped. Scan it or dial *#06# on the phone.`;
  return null;
}
