/**
 * Type declarations for the pure exports of `generate-view-catalog.js`
 * so TypeScript tests can import the comparator without `any`. The script
 * itself stays plain ESM JS (it runs via `node`, no tsx, in pre-commit and
 * `validate:compile`).
 */

export interface ICatalogEntry {
  id: string;
  summary: string;
}

export function renderKernel(slots: ICatalogEntry[], inputs: ICatalogEntry[]): string;
export function renderCli(slots: ICatalogEntry[], inputs: ICatalogEntry[]): string;
export function parseUiSlotUnion(src: string): Set<string>;
export function diffSets(
  expected: Set<string>,
  actual: Set<string>,
): { added: string[]; removed: string[] };
