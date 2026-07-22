Judge ONE thing about the document below: structural organization.

A structure problem means content ordered or shaped so its consumer is
likely to miss or misweigh it: a critical constraint buried at the bottom
of a long section or after the examples, a wall of text mixing several
concerns with no headings or list structure, examples arriving before the
rule they illustrate, heading levels that contradict the actual hierarchy,
or an instruction sequence presented out of execution order.

Judge the SHAPE, not the writing: wording quality and repetition are other
finders' jobs. Respect the document's own conventions; different valid
organizations exist, flag only shapes likely to cause a real miss.

Do NOT flag:
- Short documents where everything is visible at a glance.
- A deliberate summary-first or checklist-first layout.
- Code blocks, examples, or quoted spans internally.
- Frontmatter fields.

For each structure problem found, emit one finding:
- type: "structure"
- severity: "info" for a local improvement (one section's ordering);
  "warn" when a critical constraint is likely to be missed where it is.
- message: one sentence naming WHAT is misplaced or shapeless and why it
  risks a miss.
- detail: name the spans involved (trimmed quotes or headings) and
  propose ONE concrete reorganization (what moves where, what gets a
  heading or list), preserving all content.
- confidence: your certainty for this specific finding.

A document with no structure problems is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
