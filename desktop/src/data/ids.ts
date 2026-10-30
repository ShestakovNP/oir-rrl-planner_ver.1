/** Short random ids (crypto-based when available). */
export function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '').slice(0, 16);
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 16);
}
