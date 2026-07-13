import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// Node 原生 fetch 不读取 HTTP(S)_PROXY 环境变量；显式接入环境代理，
// 无代理环境（如 GitHub Actions）下自动退化为直连
setGlobalDispatcher(new EnvHttpProxyAgent());

const UA = 'ai-insight-dashboard/0.1 (+https://github.com/SmileTAT/ai-insight-dashboard)';

const BACKOFF_MS = [2000, 4000, 8000, 16000];

export async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'user-agent': UA, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(60_000),
      });
      // 4xx（限流除外）没有重试价值，直接返回给调用方判断
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastError = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < BACKOFF_MS.length) {
      await sleep(BACKOFF_MS[attempt]);
    }
  }
  throw lastError;
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
