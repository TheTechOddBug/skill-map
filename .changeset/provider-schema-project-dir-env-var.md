---
'@skill-map/spec': patch
---

`provider.schema.json` rejected `activity.install.projectDirEnvVar`, the field the installer has honoured since the Claude hooks were anchored on `CLAUDE_PROJECT_DIR`: the `install` object is `additionalProperties: false` and the property was never added, so only an external provider plugin declaring it ever hit the error. It is now accepted on `json-hooks` (uppercase env-var name) and forbidden on `plugin-file`, which spawns nothing.
