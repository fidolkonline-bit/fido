import { ZodError } from "zod";

export type FormState = { error?: string; ok?: string } | undefined;

// Turns thrown validation/business errors into a message shown beside the form.
export function formError(e: unknown): FormState {
  if (e instanceof ZodError) return { error: e.issues.map((i) => i.message).join(" ") };
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  if (e instanceof Error) {
    if (e.message.includes("Unique constraint")) return { error: "A record with this code or name already exists." };
    return { error: e.message };
  }
  return { error: "Something went wrong. Nothing was saved." };
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v == null ? null : Number(v);
};
