import { waLink } from "@/lib/whatsapp";

// Opens WhatsApp with the message ready to send. Renders nothing when the customer has no usable mobile number.
export function WhatsAppLink({ phone, text, label = "WhatsApp", className = "btn" }: { phone: string | null | undefined; text: string; label?: string; className?: string }) {
  const href = waLink(phone, text);
  if (!href) return null;
  return <a className={`${className} no-print`} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
}
