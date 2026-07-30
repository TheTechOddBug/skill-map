-- Unprefixed on purpose. A kernel that INJECTED the missing prefix would
-- create `plugin_storeplug_rule_exceptions` and report success, leaving
-- the author with a table whose name appears nowhere in their source.
-- The contract is refusal.
CREATE TABLE rule_exceptions (
  id INTEGER PRIMARY KEY,
  note TEXT
);
