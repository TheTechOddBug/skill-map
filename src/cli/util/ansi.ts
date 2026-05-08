/**
 * Minimal ANSI palette + TTY/--no-color/env resolver for verb output.
 *
 * Mirrors the precedence rules in `serve-banner.ts` so every verb that
 * adopts this helper resolves color the same way: `--no-color` flag wins,
 * then `NO_COLOR` env (any non-empty value), then `FORCE_COLOR` env (any
 * non-empty value forces enable even on non-TTY), else fall back to
 * `isTTY`. Repo policy is no new color deps — raw 256-color escapes are
 * kept short and inline.
 *
 * Returns an `IAnsi` object whose methods are no-ops when color is
 * disabled, so callers can wrap strings unconditionally:
 *
 *   const ansi = ansiFor({ isTTY, noColorFlag });
 *   line = `  ${ansi.green('✓')}  ${id}`;
 */

const ESC = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[38;5;42m',
  red: '\x1b[38;5;203m',
  yellow: '\x1b[38;5;214m',
  cyan: '\x1b[38;5;81m',
} as const;

export interface IAnsi {
  green: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

const NOOP: IAnsi = {
  green: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
};

const ENABLED: IAnsi = {
  green: (s) => `${ESC.green}${s}${ESC.reset}`,
  red: (s) => `${ESC.red}${s}${ESC.reset}`,
  yellow: (s) => `${ESC.yellow}${s}${ESC.reset}`,
  cyan: (s) => `${ESC.cyan}${s}${ESC.reset}`,
  dim: (s) => `${ESC.dim}${s}${ESC.reset}`,
  bold: (s) => `${ESC.bold}${s}${ESC.reset}`,
};

export interface IAnsiResolveInput {
  isTTY: boolean;
  noColorFlag: boolean;
  env?: NodeJS.ProcessEnv;
}

export function ansiFor(opts: IAnsiResolveInput): IAnsi {
  if (opts.noColorFlag) return NOOP;
  const env = opts.env ?? process.env;
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return NOOP;
  const forceColor = env['FORCE_COLOR'];
  if (forceColor !== undefined && forceColor !== '') return ENABLED;
  return opts.isTTY ? ENABLED : NOOP;
}
