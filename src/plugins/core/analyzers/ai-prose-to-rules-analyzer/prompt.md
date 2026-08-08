Judge ONE thing about the document below: enumerable rules buried in
prose.

A buried rule is a normative directive, a must, a never, an always, an
only-when, a do-X-before-Y, written inside a narrative paragraph where a
consuming agent is likely to gloss over it. Flag a span of prose when it
encodes TWO OR MORE such directives that would serve their reader better
as an explicit checklist: discrete items, one imperative per line.

Judge what the span ENCODES, not where it sits: whether a section is
well placed, well ordered, or well headed is a different judgment.
A span qualifies here purely because enumerable normative content is
hiding in paragraph form.

Do NOT flag:
- Prose that already is a list, a checklist, or a table of rules.
- A paragraph carrying a single directive (one rule alone does not need
  a checklist).
- Descriptive or narrative prose with no directives.
- The rationale AROUND rules: explanation of why a rule exists is
  context, not an extra rule, and a good checklist may keep a short why
  per item.
- Code blocks, examples, or quoted spans.
- Frontmatter fields.

For each buried-rules span found, emit one finding:
- type: "prose-to-rules"
- severity: "info" (this is an improvement proposal, not a defect).
- message: one sentence naming the span and how many discrete rules it
  encodes.
- detail: quote the span's opening words (trimmed), then extract the
  rules as checklist items, one imperative per line prefixed with
  `- [ ] `, in the order they appear, preserving each rule's meaning
  and any inline condition it carries. The detail IS the proposed
  checklist, ready to paste.
- confidence: your certainty for this specific finding.

A document with no buried rules is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
