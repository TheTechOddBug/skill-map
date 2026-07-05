/**
 * Shared helpers for the Project-section children
 * (`settings-project-*.ts`). Kept tiny on purpose: the children are
 * independent state machines and this module is the only thing they
 * share besides the row CSS vocabulary.
 */

import { DataSourceError } from '../../../services/data-source/data-source.port';

export function formatErr(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
