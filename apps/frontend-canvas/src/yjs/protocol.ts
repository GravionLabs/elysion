/** Must match apps/realtime/src/yjs/protocol.ts — the two sides of one wire format. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/** The server refused an update because the board is full (ADR 0026); no payload. */
export const MESSAGE_BOARD_FULL = 4;
