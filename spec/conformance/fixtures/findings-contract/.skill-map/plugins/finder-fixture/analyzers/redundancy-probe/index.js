// Conformance fixture: a THIRD-PARTY probabilistic finder Analyzer.
// Ships the files-by-convention pair (`prompt.md` + `report.schema.json`
// extending the canonical findings envelope) and NO `evaluate()`: its
// judgment is a queued job an external agent drains (`sm job claim` +
// `sm record`), never a scan-time pass.
//
// The companion cases `findings-contract.json` /
// `findings-contract-kind.json` submit a job for this finder over
// `notes.md`, then assert (a) the rendered content embeds the findings
// envelope `$ref` inside the report contract (`sm job preview --last`)
// and (b) the queued row froze `extensionKind: "analyzer"`
// (`sm job list --json`).
export default {
  version: '0.1.0',
  description:
    'Conformance finder: judges one node for internal redundancy (fixture twin of the core/ai-redundancy-analyzer built-in).',
  mode: 'probabilistic',
  probExpectedDurationSeconds: 60,
};
