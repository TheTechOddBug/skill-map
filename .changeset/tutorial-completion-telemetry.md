---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

`sm tutorial --completed <part-id|book>` is a new silent milestone ping the bundled sm-tutorial skill runs at each part close and at the final wrap-up: no scaffolding, no empty-cwd requirement, exit 0 always, out-of-catalog ids collapse to `unknown`. The opt-in `cli.tutorial` usage event carries the milestone as `tutorial_part` (and as the URL / Screen value `tutorial:<id>`), so tutorial completion becomes observable by part name. Contract in `spec/cli-contract.md` and `spec/telemetry.md`.
