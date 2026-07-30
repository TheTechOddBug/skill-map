-- The manifest declares the LOGICAL table name (rule_exceptions); the
-- migration MUST write the PHYSICAL, prefixed one. The kernel enforces
-- the plugin_<normalizedId>_ namespace rather than injecting it, so the
-- name written here is the name that lands on disk.
CREATE TABLE plugin_storeplug_rule_exceptions (
  id INTEGER PRIMARY KEY,
  node_path TEXT NOT NULL,
  note TEXT
);

-- Note the index name: EVERY object must START with the prefix, indexes
-- included, so the ix_<table>_<cols> convention the kernel uses for its
-- own indexes is not available to a plugin. A name like
-- ix_plugin_storeplug_rule_exceptions_node is refused, because it starts
-- with ix_ rather than with the namespace.
CREATE INDEX plugin_storeplug_rule_exceptions_node_ix
  ON plugin_storeplug_rule_exceptions (node_path);
