/** Typed BATON browser/client SDK. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
  status: number;
  method: HttpMethod;
  path: string;

  constructor(method: HttpMethod, path: string, status: number) {
    super(`${method} ${path} → ${status}`);
    this.name = 'ApiError';
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

export type BatonClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export function createClient(options: BatonClientOptions = {}) {
  const base = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(base + path, init);
    if (!res.ok) throw new ApiError(method, path, res.status);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    patch: <T = unknown>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    del: <T = unknown>(path: string) => request<T>('DELETE', path),
  };
}

const defaultClient = createClient();

export const get = defaultClient.get;
export const post = defaultClient.post;
export const patch = defaultClient.patch;
export const del = defaultClient.del;

export type SseHandlers = Record<string, (data: unknown) => void> & {
  message?: (data: unknown) => void;
};

export function createSSE(path: string, handlers: SseHandlers = {}) {
  let es: EventSource | null = null;
  let retryMs = 1000;

  function connect() {
    es = new EventSource(path);
    es.onopen = () => { retryMs = 1000; };
    es.onerror = () => {
      es?.close();
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };
    for (const [event, fn] of Object.entries(handlers)) {
      if (event === 'message') continue;
      es.addEventListener(event, (e) => {
        const msg = e as MessageEvent<string>;
        fn(JSON.parse(msg.data));
      });
    }
    es.onmessage = (e) => {
      if (handlers.message) handlers.message(JSON.parse(e.data));
    };
  }

  connect();
  return { close: () => es?.close() };
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function humanTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return 'Yesterday';
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
