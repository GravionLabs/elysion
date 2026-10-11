/** Must match apps/realtime/src/yjs/protocol.ts — the two sides of one wire format. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/** The server refused an update because the board is full (ADR 0026); no payload. */
export const MESSAGE_BOARD_FULL = 4;
/**
 * The realtime service tells the clients of a board that its voting changed (ADR 0029). The payload is the UTF-8 JSON
 * `{ event, voting }` (a `VotingBroadcast`); it follows the type as a length-prefixed string (`writeVarString`), a payload
 * that fills the rest of the message is read as well.
 */
export const MESSAGE_VOTING = 5;
