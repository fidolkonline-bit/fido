// GRN lot numbers: supplier code + receiving date (DDMMYY, Sri Lanka time), e.g. MTCP-181126.
// A second delivery from the same supplier on the same day becomes MTCP-181126-2, then -3…

// "Multi Trade Center Peta" → "MTCP". Used to suggest a supplier code, and as the lot prefix when none is set.
export function nameInitials(name: string) {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("").slice(0, 10);
  return initials.length >= 2 ? initials : (words.join("").slice(0, 4) || "LOT");
}

export function lotPrefix(supplier: { supplierCode: string | null; name: string }) {
  return supplier.supplierCode || nameInitials(supplier.name);
}

export function lotDate(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit", month: "2-digit", year: "2-digit" })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.day}${p.month}${p.year}`;
}

// Next free lot for this base, given lot codes already used that start with it.
export function nextLot(base: string, used: (string | null)[]) {
  let max = 0;
  for (const u of used) {
    if (u === base) max = Math.max(max, 1);
    const m = u?.startsWith(base + "-") ? /^(\d+)$/.exec(u.slice(base.length + 1)) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max === 0 ? base : `${base}-${max + 1}`;
}
