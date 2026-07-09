/**
 * The one response shape every route handler uses:
 * `{ok: true, data} | {ok: false, error: {code, message}}`.
 */

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data } satisfies ApiEnvelope<T>, init);
}

export function fail(code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, error: { code, message } } satisfies ApiEnvelope<never>,
    { status },
  );
}
