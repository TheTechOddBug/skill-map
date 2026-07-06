/**
 * Shared distillation of a parser-library throw (`yaml.load`,
 * `smol-toml.parse`) into a single-line, control-character-free
 * `IParseIssue.message`. Both built-in metadata parsers consume it so
 * the sanitisation posture cannot drift between formats: strip C0
 * control bytes AND DEL (`\x7f`), then collapse whitespace runs, so a
 * multi-line "reason\n  in ..." string can never break a single-line
 * log render or smuggle ANSI escapes through a downstream consumer.
 */
export function sanitiseParseErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
