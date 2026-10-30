/**
 * Network access. In the desktop app requests go through the Tauri HTTP plugin,
 * which only reaches the hosts allow-listed in src-tauri/capabilities/default.json
 * and lets us send an identifying User-Agent. In a plain browser (dev mode) the
 * standard fetch is used.
 */
import { USER_AGENT } from '../config';
import { isTauri } from '../platform';
import { reportNetwork } from './online';

type TauriFetch = (input: string, init?: RequestInit) => Promise<Response>;
let tauriFetch: TauriFetch | null = null;

async function getTauriFetch(): Promise<TauriFetch> {
  if (!tauriFetch) {
    const mod = await import('@tauri-apps/plugin-http');
    tauriFetch = mod.fetch as unknown as TauriFetch;
  }
  return tauriFetch;
}

export class NetworkError extends Error {
  constructor(message: string, readonly offline: boolean) {
    super(message);
  }
}

export async function httpGet(url: string, opts: { accept?: string; timeoutMs?: number } = {}): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    reportNetwork(false);
    throw new NetworkError('Нет подключения к интернету.', true);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const headers: Record<string, string> = { Accept: opts.accept ?? '*/*' };
    let res: Response;
    if (isTauri()) {
      const f = await getTauriFetch();
      res = await f(url, { method: 'GET', headers: { ...headers, 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    } else {
      res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    }
    reportNetwork(true);
    return res;
  } catch (e) {
    reportNetwork(false);
    const aborted = (e as Error)?.name === 'AbortError';
    throw new NetworkError(aborted ? 'Сервер не ответил вовремя.' : 'Не удалось связаться с сервером. Проверьте интернет.', !aborted);
  } finally {
    clearTimeout(timer);
  }
}

export async function httpJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await httpGet(url, { accept: 'application/json', timeoutMs });
  if (!res.ok) throw new NetworkError(`Сервис ответил ошибкой ${res.status}.`, false);
  return (await res.json()) as T;
}
