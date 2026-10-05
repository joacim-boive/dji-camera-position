const NAME_PATTERN = /dji|osmo/i;

export function nameMatches(name: string, tokens: readonly string[]): boolean {
  if (NAME_PATTERN.test(name)) {
    return true;
  }
  const lower = name.toLowerCase();
  return tokens.some(
    (token) => token.length >= 8 && lower.includes(token.toLowerCase()),
  );
}
