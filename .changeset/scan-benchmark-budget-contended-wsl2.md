---
"@skill-map/cli": patch
---

The scan benchmark's perf budget (`BUDGET_MS` in `src/__tests__/integration/scan-benchmark.spec.ts`) doubles from 10s to 20s after a 10.48s trip on WSL2 under heavy parallel suite load; the isolated baseline on the same machine is ~1.4s, so the budget still catches order-of-magnitude regressions while absorbing worst-case host contention. Test-only change, no runtime behaviour affected.
