---
'@skill-map/cli': patch
---

Terminal sanitisation moves from the log call sites into `Logger` itself, so ANSI escapes and control bytes are stripped from every message and every context value on the way to stderr instead of wherever an author remembered to wrap the interpolation. Eleven sites had grown their own wrapper and two interpolating ones had been missed. Measured at ~136 ns per line, which is nothing against a stream write.
