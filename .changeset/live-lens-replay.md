---
'@skill-map/cli': minor
---

The Live lens gains a session replay: a recorder tapes every activity frame the page receives (bounded ring, page-lifetime), and a new transport in the map replays the whole session one event per second under an amber REPLAY frame, with play/pause, a scrubber, single-event stepping and a ticker narrating each event. The replayed state is a pure fold in virtual time (same claim semantics as the live glow), so scrubbing is instant and nothing re-executes.

## User-facing

Replay your session on the map: the Live lens now records what your AI did and can play it back, one event per second, with a scrubber to jump anywhere. Watch nodes light up and calls appear exactly as they happened, without re-running anything.
