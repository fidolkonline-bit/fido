import { db } from "./db";

// Built-in error log (no outside service): every server error is written to the ErrorLog table and shown under
// Settings › Error log. Expected refusals (no permission, sign-in redirects, not-found) are left out.
export async function logRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
) {
  const e = err as { message?: string; stack?: string; digest?: string };
  const message = String(e?.message ?? err).slice(0, 1000);
  if (/permission for this action|NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR/.test(message + (e?.digest ?? ""))) return;
  try {
    await db.errorLog.create({
      data: {
        message, stack: e?.stack?.slice(0, 6000) ?? null, digest: e?.digest?.slice(0, 80) ?? null,
        path: request.path.split("?")[0].slice(0, 300), method: request.method, route: context.routePath.slice(0, 200), kind: context.routeType,
      },
    });
  } catch {
    // The log must never break the request it is recording.
  }
}
