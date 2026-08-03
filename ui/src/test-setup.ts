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

/**
 * Virtual-scroll geometry stubs, scoped to PrimeNG's scroller viewport.
 *
 * The files rail runs `<p-table [virtualScroll]="true">`, and the scroller
 * refuses to initialise at all in jsdom: `@primeuix/utils` defines
 * `isVisible(el) = !!(el && el.offsetParent != null)`, `Scroller.viewInit()`
 * gates `setInitialState()` + `init()` on it, and jsdom hardcodes
 * `get offsetParent() { return null }`. Without a stub `initialized` never
 * flips, `calculateOptions()` never runs, the rendered slice stays
 * `items.slice(0, 0)` and EVERY row assertion in a files-view spec sees an
 * empty table. Note this is not the same thing as `offsetHeight`: patching
 * only the height changes nothing, because the code reading it never runs.
 *
 * The stubs are deliberately scoped to `.p-virtualscroller` instead of
 * lying globally: `isVisible` is also consumed by select, multiselect,
 * tieredmenu, panelmenu and styleclass, and a blanket `offsetParent` would
 * silently change behaviour across unrelated specs.
 *
 * With an 800px viewport and 36px rows the scroller computes
 * `numItemsInViewport = 23`, `numToleratedItems = 12` and therefore
 * `last = min(items.length, 47)`. Any spec with fewer than 47 rows renders
 * its whole dataset, so DOM assertions stay total. A spec that needs more
 * rows than that must either assert against the window deliberately or
 * raise this viewport.
 */
const SCROLLER_SELECTOR = '.p-virtualscroller';
const TEST_VIEWPORT_H = 800;
const TEST_VIEWPORT_W = 600;

function isScroller(el: unknown): boolean {
  const node = el as { matches?: (s: string) => boolean } | null;
  return typeof node?.matches === 'function' && node.matches(SCROLLER_SELECTOR);
}

function installGeometryStub(target: unknown, ctorName: 'HTMLElement' | 'Element'): void {
  if (typeof target !== 'object' || target === null) return;
  const ctor = (target as Record<string, unknown>)[ctorName] as
    | { prototype?: object }
    | undefined;
  const proto = ctor?.prototype;
  if (!proto) return;

  const define = (prop: string, value: number): void => {
    const existing = Object.getOwnPropertyDescriptor(proto, prop) as
      | { get?: { __smStub?: boolean } }
      | undefined;
    if (existing?.get?.__smStub) return;
    const getter = function (this: unknown): number {
      return isScroller(this) ? value : 0;
    };
    (getter as { __smStub?: boolean }).__smStub = true;
    Object.defineProperty(proto, prop, { get: getter, configurable: true });
  };

  if (ctorName === 'HTMLElement') {
    const parentDescriptor = Object.getOwnPropertyDescriptor(proto, 'offsetParent') as
      | { get?: { __smStub?: boolean } }
      | undefined;
    if (!parentDescriptor?.get?.__smStub) {
      const getter = function (this: { ownerDocument?: Document }): Element | null {
        return isScroller(this) ? (this.ownerDocument?.body ?? null) : null;
      };
      (getter as { __smStub?: boolean }).__smStub = true;
      Object.defineProperty(proto, 'offsetParent', { get: getter, configurable: true });
    }
    define('offsetHeight', TEST_VIEWPORT_H);
    define('offsetWidth', TEST_VIEWPORT_W);
  } else {
    define('clientHeight', TEST_VIEWPORT_H);
    define('clientWidth', TEST_VIEWPORT_W);
  }
}

/**
 * `Element.prototype.scrollTo`, which jsdom 29 does not implement at all
 * (the scroller calls it, and so does the rail's own reveal path). Writing
 * the coordinates through to `scrollTop` / `scrollLeft` (plain writable
 * properties in jsdom) is what lets reveal specs assert an exact scroll
 * position instead of merely "it did not throw".
 */
function installScrollToStub(target: unknown): void {
  if (typeof target !== 'object' || target === null) return;
  const ctor = (target as Record<string, unknown>)['Element'] as { prototype?: object } | undefined;
  const proto = ctor?.prototype as Record<string, unknown> | undefined;
  if (!proto) return;
  const current = proto['scrollTo'] as { __smStub?: boolean } | undefined;
  if (current?.__smStub) return;
  const stub = function (this: Record<string, unknown>, options?: ScrollToOptions | number): void {
    if (typeof options === 'number') {
      this['scrollLeft'] = options;
      return;
    }
    if (options?.top !== undefined) this['scrollTop'] = options.top;
    if (options?.left !== undefined) this['scrollLeft'] = options.left;
  };
  (stub as { __smStub?: boolean }).__smStub = true;
  proto['scrollTo'] = stub;
}

/**
 * Install a COMPLETE `matchMedia` on a target.
 *
 * jsdom ships none, and `ThemeService.subscribeToSystemPref` guards on
 * `typeof win.matchMedia !== 'function'`, so its absence is safe. What is NOT
 * safe is a PARTIAL one: a stub that returns just `{ matches }` passes the
 * guard and then dies on `mq.addEventListener is not a function`, taking down
 * every spec that constructs the service through DI.
 *
 * That is not hypothetical, it is the CI failure of 2026-08-03. A spec assigned
 * a `{ matches }`-only `window.matchMedia` and never restored it, so whichever
 * files Vitest happened to schedule LATER IN THE SAME WORKER inherited a
 * booby-trapped global. Worker assignment varies by machine, so the suite was
 * green locally and failed intermittently in CI on an unrelated file.
 *
 * Installing a full `MediaQueryList` here means no spec has to know about this,
 * and a spec that needs specific `matches` semantics overrides the value
 * without having to reconstruct the shape (see `files-view.reveal.spec.ts`).
 */
function installMatchMediaStub(target: unknown): void {
  if (target === null || typeof target !== 'object') return;
  const holder = target as Record<string, unknown>;
  // Never clobber a real implementation, only fill the jsdom gap (and refresh
  // our own stub). Mirrors the `__smStub` guard the geometry / scrollTo stubs
  // above use.
  const current = holder['matchMedia'] as { __smStub?: boolean } | undefined;
  if (current !== undefined && current.__smStub !== true) return;

  const stub = (query: string): MediaQueryList => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mql = {
      media: query,
      matches: false,
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void): void => {
        listeners.delete(listener);
      },
      // Deprecated pair, still what some libraries reach for first.
      addListener: (listener: (event: MediaQueryListEvent) => void): void => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void): void => {
        listeners.delete(listener);
      },
      dispatchEvent: (event: Event): boolean => {
        for (const listener of listeners) listener(event as MediaQueryListEvent);
        return true;
      },
    };
    return mql as unknown as MediaQueryList;
  };
  (stub as { __smStub?: boolean }).__smStub = true;
  holder['matchMedia'] = stub;
}

for (const t of targets) {
  installGeometryStub(t, 'HTMLElement');
  installGeometryStub(t, 'Element');
  installScrollToStub(t);
  installMatchMediaStub(t);
}
