/** Yjs's own wire message type tags — see y-protocols and the (now-archived) y-websocket server reference implementation. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/**
 * The server tells a client that the board is full (ADR 0026): an update was refused because the document is at its
 * size limit. No payload. A client that knows the type says so; one that does not ignores it.
 */
export const MESSAGE_BOARD_FULL = 4;
