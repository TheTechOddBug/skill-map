/**
 * Minimal zero-dep argv parser shared by the tutorial scripts. Splits
 * `--key value` pairs and bare `--flag` booleans from positionals.
 * No external CLI framework (the script ships to a tester cwd with no
 * node_modules).
 */

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
