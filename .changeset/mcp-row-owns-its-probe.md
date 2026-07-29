---
'@skill-map/cli': patch
---

The Quick Start "MCP installed on your agent" row stopped borrowing the MCP server's on/off health, the fact the row above already reports: repeating it here painted this row green while its own detail line read "no agent attached yet". It owns its live-connection probe again ("Not checked yet" until Check, then "Connected" / "Not connected yet"), and an unconnected verdict explains that an agent working the queue over the CLI never opens a session.

## User-facing

The Quick Start MCP row no longer reports itself as done before you check it. It stays "Not checked yet" until you hit Check, then says whether an agent is really connected, with a note explaining that an agent working the queue over the CLI never opens a connection.
