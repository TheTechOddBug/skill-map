/**
 * Re-export shim — historical home of `IPrinter` + `createPrinter`.
 * Real implementation lives in `core/runtime/printer.ts` so the BFF
 * (`src/server/`) and the scan / plugin runtime can consume the
 * abstraction without crossing into `src/cli/`. CLI consumers keep
 * importing from here unchanged.
 */

export {
  createPrinter,
  type IPrinter,
  type ICreatePrinterOptions,
} from '../../core/runtime/printer.js';
