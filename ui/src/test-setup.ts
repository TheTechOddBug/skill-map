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
  // Inspect via the property descriptor, never a bare `obj[prop]` read: that
  // read would invoke Node's experimental Web Storage getter, which prints
  // `ExperimentalWarning: localStorage is not available because
  // --localstorage-file was not provided` once per test process.
  // `getOwnPropertyDescriptor` never calls the getter.
  const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
  const existing =
    descriptor && 'value' in descriptor ? (descriptor.value as Storage | undefined) : undefined;
  if (existing && typeof existing.clear === 'function') return;
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

/**
 * `ResizeObserver` polyfill. JSDOM does not implement the geometry
 * APIs that Foblex Flow (`FResizeChannel` in particular) wires up on
 * `ngAfterViewInit`. Without this shim, any spec that mounts a
 * Foblex-backed component (e.g. `GraphView` via `InspectorView`)
 * surfaces a `ReferenceError: ResizeObserver is not defined`
 * outside the per-test try/catch, which Vitest reports as an
 * unhandled error and fails the run.
 *
 * The no-op implementation is enough: tests that care about layout
 * stub the dagre engine, and tests that do not care simply need the
 * constructor to exist.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
function installResizeObserver(target: unknown): void {
  if (typeof target !== 'object' || target === null) return;
  const obj = target as Record<string, unknown>;
  if (typeof obj['ResizeObserver'] === 'function') return;
  obj['ResizeObserver'] = NoopResizeObserver;
}
for (const t of targets) {
  installResizeObserver(t);
}

/**
 * `HTMLCanvasElement.prototype.getContext` stub. JSDOM does not implement
 * canvas rendering without the native `canvas` npm package, so any spec that
 * mounts a canvas-backed component (today `<sm-perf-hud>`, which draws a
 * sparkline) trips JSDOM's `Not implemented: HTMLCanvasElement's getContext()`
 * console error. Returning a no-op 2D context lets the draw path run silently;
 * production keeps the real browser context. The Proxy answers every method
 * with a no-op and remembers assigned properties (`strokeStyle`, `lineWidth`,
 * ...), so callers neither throw nor read back garbage.
 */
function createNoop2dContext(): CanvasRenderingContext2D {
  const props = new Map<PropertyKey, unknown>();
  const noop = (): undefined => undefined;
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getImageData' || prop === 'createImageData') {
          return () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
        }
        return props.has(prop) ? props.get(prop) : noop;
      },
      set(_target, prop, value) {
        props.set(prop, value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function installCanvasContextStub(target: unknown): void {
  if (typeof target !== 'object' || target === null) return;
  const ctor = (target as Record<string, unknown>)['HTMLCanvasElement'] as
    | { prototype?: Record<string, unknown> }
    | undefined;
  const proto = ctor?.prototype;
  if (!proto) return;
  const current = Object.getOwnPropertyDescriptor(proto, 'getContext')?.value as
    | { __smStub?: boolean }
    | undefined;
  if (current?.__smStub) return;
  const stub = (): CanvasRenderingContext2D => createNoop2dContext();
  (stub as { __smStub?: boolean }).__smStub = true;
  proto['getContext'] = stub;
}
for (const t of targets) {
  installCanvasContextStub(t);
}
