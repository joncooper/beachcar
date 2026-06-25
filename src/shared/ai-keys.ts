export function looksLikeRawProviderKey(value: string): boolean {
  return /^(sk[-_]|sk_live_|sk-proj-|sess-)/i.test(value.trim());
}
