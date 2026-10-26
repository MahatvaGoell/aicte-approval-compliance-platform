// Thin fetch wrapper. Every mutation carries the CSRF header and an idempotency key;
// errors come back as ApiError with the server's stable code and correlation ID.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: any,
    public correlationId: string | null,
  ) {
    super(message);
  }
}

function newKey() {
  return 'web-' + crypto.randomUUID();
}

async function request<T>(method: string, url: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'aicte-web' };
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${url}`, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check that the API is running and try again.', null, null);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details ?? null, e.correlationId ?? null);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}, key: string = newKey()) => request<T>('POST', url, body, key),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  upload: <T>(url:string,body:FormData,key:string=newKey())=>request<T>('POST',url,body,key),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}
