---
'@skill-map/cli': patch
---

The MCP registration rows (Quick Start and Settings > Project) hold the "paste it into <file>" instruction back until the snippet has actually been copied, so the hint line reads copy, then the clipboard confirmation, then where the document goes. The target is gated on a sticky flag, so it survives the button's two-second confirmation instead of flashing past with it.

## User-facing

The MCP row no longer tells you where to paste a config you have not copied yet. Click Copy, and once the "Copied to the clipboard" confirmation fades the row names the file the snippet belongs in.
