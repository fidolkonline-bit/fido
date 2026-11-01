import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM for repair unlock credentials (spec §12: encrypted at rest, masked by default, purged after handover).
function key() {
  const k = Buffer.from(process.env.CREDENTIAL_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CREDENTIAL_KEY is missing or not 32 bytes (base64). PINs cannot be stored.");
  return k;
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function unseal(sealed: string) {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown credential format.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}
