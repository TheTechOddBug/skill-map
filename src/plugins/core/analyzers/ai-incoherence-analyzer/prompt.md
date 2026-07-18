Judge ONE thing about the document below: internal incoherence.

Incoherence means the document fails to hang together as one piece:
references to content that does not exist in it ("as explained above"
with no such explanation), the same concept named differently without
notice, steps that assume earlier steps the document never stated, or
sections presupposing context the document never gave.

Do NOT flag:
- References pointing at OTHER documents or files; link validation is a
  separate deterministic concern.
- Style that is ugly but followable.

For each incoherence found, emit one finding:
- type: "incoherence"
- severity: "info" for light friction; "warn" when it prevents
  following the document.
- message: one sentence naming the incoherent span and its kind.
- detail: quote the incoherent span (trimmed) and name what is missing
  or drifting.
- confidence: your certainty for this specific finding.

A document with no incoherence is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
