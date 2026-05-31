/**
 * UI strings for the `<sm-connection-banner>` shown when the live WS
 * connection to `sm serve` is lost (the reconnect loop gave up after
 * `MAX_RECONNECT_ATTEMPTS`). User-facing, rendered in the shell, not a
 * developer console log (those live in `ws.texts.ts`).
 *
 * Function-style entries take parameters so the catalog stays
 * Transloco-ready when a real i18n framework lands.
 */
export const CONNECTION_BANNER_TEXTS = {
  body: 'Connection to the server was lost. Live updates are paused.',
  reconnectCta: 'Reconnect',
  reconnectAria: 'Retry the connection to the server',
} as const;
