---
'@skill-map/spec': minor
---

Two more coverage rows closed with the primitives already in place. The findings envelope now has conformance cases on both sides: a recorded finder report writes its rows through with `type` / `severity` / `confidence` intact, and a sibling differing only in an out-of-enum `severity` is rejected with exit 2 and writes nothing. That record-side write-through previously lived only in implementation integration tests because it needs the claim-issued nonce.
