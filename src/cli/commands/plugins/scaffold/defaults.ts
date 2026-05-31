/**
 * Defaults the scaffolded stubs reference, pulled from the generated
 * catalog (NOT hardcoded as raw strings). Typing them against the kernel
 * catalog means removing the default slot / input-type from the spec is a
 * TypeScript compile error here, caught by `validate:compile`, instead of
 * a stub that silently ships a `slot` the catalog no longer contains.
 */

import type { TInputTypeName, TSlotName } from '../../../../kernel/types/view-catalog.js';

export const DEFAULT_SLOT: TSlotName = 'card.footer.left';
export const DEFAULT_INPUT_TYPE: TInputTypeName = 'string-list';
