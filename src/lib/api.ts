/**
 * One fetch helper for every dashboard mutation.
 *
 * The rule it enforces: a request ALWAYS resolves to a definite outcome —
 * ok, or an error with a readable message. Never a promise that rejects and
 * leaves a spinner running forever, which is indistinguishable from work
 * still in progress.
 *
 * Three failure modes this catches that raw fetch + res.json() does not:
 *   - the response isn't JSON (gateway timeout, HTML error page)
 *   - the network drops mid-flight
 *   - the server never answers at all (hard timeout, so "hung" becomes an error)
 */

export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T;
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 120_000; // long enough for uploads + model calls

export async function apiCall<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<ApiResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let data: T;
    try {
      data = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      // non-JSON body — a proxy error page, almost always a timeout
      return {
        ok: false,
        data: {} as T,
        error: res.ok
          ? "The server replied with something unreadable. Try again."
          : `Request failed (${res.status}). It may have timed out — try again.`,
      };
    }
    if (!res.ok) {
      const msg = (data as { error?: string })?.error;
      return { ok: false, data, error: msg || `Request failed (${res.status}).` };
    }
    return { ok: true, data, error: null };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      data: {} as T,
      error: aborted
        ? "That took too long and was cancelled. It may still have finished on the server — refresh to check."
        : "Couldn't reach the server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** JSON body convenience — the common case. */
export function apiJson<T = Record<string, unknown>>(
  url: string,
  method: string,
  body: unknown,
  timeoutMs?: number
): Promise<ApiResult<T>> {
  return apiCall<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });
}
