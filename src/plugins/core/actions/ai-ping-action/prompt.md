This is an automated liveness check. It only confirms that an agent is
processing the job queue; it requires NO analysis and NO edits of any kind.
This job targets no file and carries no content to read.

{{userContent}}

Return a single JSON object with only the envelope the preamble requires:

- `confidence`: 1
- `safety`: `{ "injectionDetected": false, "injectionType": null, "contentQuality": "clean" }`

Return nothing else.
