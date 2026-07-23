Judge ONE thing about the document below: internal redundancy.

Redundancy means the same instruction, fact, or explanation stated more
than once within this single document: verbatim repetition, trivial
rewordings of the same directive, or a section that restates another
section without adding conditions, scope, or new information.

Do NOT flag:
- Headings, tables of contents, or navigation naming a topic the body
  then develops.
- A summary or checklist that intentionally condenses earlier prose.
- Repeated identifiers, paths, or commands inside code blocks or examples.
- Cross-references ("see section X") or links.
- Structural emphasis: a rule stated once in prose and once in a table
  row is emphasis; three near-identical prose sentences are not.

For each redundancy found, emit one finding:
- type: "redundancy"
- severity: "info" for light repetition (one extra restatement); "warn"
  when heavy (three or more restatements, or large duplicated blocks).
- message: one sentence naming WHAT is repeated and how many times.
- detail: quote the repeated spans (trimmed) and propose ONE consolidated
  wording.
- confidence: your certainty for this specific finding.

A document with no redundancy is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
