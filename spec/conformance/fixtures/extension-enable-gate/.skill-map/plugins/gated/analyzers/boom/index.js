// Top-level throw: if the loader ever imports this module, the plugin
// surfaces as `load-error`. Reaching `disabled` instead is the proof
// that the enable gate ran BEFORE the import.
throw new Error('experimental extension was imported');
