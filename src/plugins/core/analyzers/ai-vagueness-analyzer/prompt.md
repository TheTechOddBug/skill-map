Judge ONE thing about the document below: vagueness.

Vagueness means a directive the consuming agent cannot act on
deterministically: "handle it appropriately" (appropriately how?), "be
careful with X" (careful meaning what check?), an output requested with
no format specified, a threshold like "too long" or "recently" with no
number, or an instruction whose success cannot be verified because no
acceptance criterion is given.

Judge only DIRECTIVES: sentences telling the reader or an agent what to
do. Descriptive or narrative prose is not vague in this sense, and a
document with no directives has nothing to flag.

Do NOT flag:
- Deliberate delegation ("use your judgment on X") where discretion is
  clearly the intent.
- Vagueness resolved elsewhere in the same document (a term defined in
  another section).
- Code blocks, examples, or quoted spans.
- Frontmatter fields.

For each vague directive found, emit one finding:
- type: "vagueness"
- severity: "info" when the ambiguity is unlikely to change behaviour;
  "warn" when two reasonable readings lead to different actions.
- message: one sentence naming the directive and WHAT is unspecified.
- detail: quote the directive (trimmed), state the readings it admits,
  and propose ONE concrete rewrite; if only the author can know the
  intended meaning, say so and list the candidate interpretations.
- confidence: your certainty for this specific finding.

A document with no vagueness is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
