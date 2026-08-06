---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Providers can now declare how an operator registers skill-map's MCP server with their runtime, through a new optional `mcpRegister` manifest block (a shell command, or a config document plus its paste target, with `{{url}}` bound to the live endpoint). It travels in the envelope `providerRegistry` and drives the Copy affordance in Quick Start and Settings, replacing a client-side catalog keyed by provider id under which every other lens, drop-in Providers included, copied the bare endpoint URL.

## User-facing

The MCP Copy button now gives the right setup line for whichever agent you are using, including agents that come from a plugin of your own, instead of falling back to just the server address.
