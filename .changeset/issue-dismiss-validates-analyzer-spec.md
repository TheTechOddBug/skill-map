---
'@skill-map/spec': minor
---

`cli-contract.md` and `mcp-server.md` document the rejection an unknown analyzer id now gets on every dismiss surface, and the deliberate asymmetry with undismiss, which keeps accepting one so a suppression left behind by an uninstalled plugin stays removable. The contract already required "the same matching as `sm check --analyzers`"; only the exit code and the asymmetry were unstated.
