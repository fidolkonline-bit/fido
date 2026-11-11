// WhatsApp click-to-chat links (free, no API account): opens WhatsApp on the staff member's phone or WhatsApp Web
// with the customer and the message filled in; staff press Send. Nothing is sent by the server.
export function waNumber(raw: string | null | undefined) {
  const d = (raw ?? "").replace(/[^\d]/g, "");
  if (/^07\d{8}$/.test(d)) return "94" + d.slice(1);
  if (/^947\d{8}$/.test(d)) return d;
  if (/^7\d{8}$/.test(d)) return "94" + d;
  // Other countries: accept a full international number written with its country code.
  if (/^\d{10,15}$/.test(d) && !d.startsWith("0")) return d;
  return null;
}

export function waLink(phone: string | null | undefined, text: string) {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
