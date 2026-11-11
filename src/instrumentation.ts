// Server errors go to the built-in error log (src/lib/error-log.ts). The database code is loaded only in the Node.js
// runtime: the middleware (edge) bundle must not pull in the Postgres driver.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRequestError } = await import("./lib/error-log");
    await logRequestError(err, request, context);
  }
}
