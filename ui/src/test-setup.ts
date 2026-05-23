/**
 * Vitest setup, runs ONCE before every spec file in the `ui/`
 * workspace via `angular.json > architect.test.options.setupFiles`.
 *
 * Polyfills `localStorage` and `sessionStorage` for tests that touch
 * persisted preferences (theme, expanded-node-ids, graph-preferences,
 * plugin-filter, etc). The `@angular/build:unit-test` runner is
 * supposed to land in a jsdom environment with the storage globals
 * already wired, but Node 24 + the experimental localStorage feature
 * competes with jsdom: the bare `globalThis.localStorage` lookup hits
 * Node's own surface, which then refuses to operate without
 * `--localstorage-file` and the spec aborts with "Cannot read
 * properties of undefined".
 *
 * The shim below is a pure in-memory `Storage` backed by a `Map`.
 * Lives only for the test process; nothing is persisted to disk. The
 * shim is installed on every global where production code might read
 * (`globalThis`, `window`, `self`) so specs pass regardless of which
 * alias the consumer uses.
 */

class InMemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function installShim(target: unknown, prop: 'localStorage' | 'sessionStorage'): void {
  if (typeof target !== 'object' || target === null) return;
  const obj = target as Record<string, unknown>;
  const current = obj[prop];
  if (current && typeof (current as Storage).clear === 'function') return;
  Object.defineProperty(obj, prop, {
    value: new InMemoryStorage(),
    writable: true,
    configurable: true,
  });
}

const targets: unknown[] = [
  globalThis,
  typeof window !== 'undefined' ? window : undefined,
  typeof self !== 'undefined' ? self : undefined,
];
for (const t of targets) {
  installShim(t, 'localStorage');
  installShim(t, 'sessionStorage');
}
