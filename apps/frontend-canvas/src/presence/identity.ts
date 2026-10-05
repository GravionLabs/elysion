import { STICKY_COLORS } from '../sticky-note';

/**
 * Who this browser tab is on a board, until real user identity exists (the login feature, #97). It is
 * made once per page load, so a reload is a new collaborator.
 */
export interface SessionIdentity {
  /** Random, unique per tab; what other clients tell tabs apart by. */
  readonly id: string;
  /** What is shown next to the cursor, e.g. "Guest 4821". */
  readonly name: string;
  /** An accent color of the design tokens, picked from the id: the same id always gets the same color. */
  readonly color: string;
}

/** Accent colors for cursors: the sticky notes' palette, which is ariadne's `--c-node-*` set. */
export const IDENTITY_COLORS: readonly string[] = STICKY_COLORS.map((color) => color.hex);

/** A small, stable hash of a string (FNV-1a); only used to spread ids over the palette and the names. */
export function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The color and name that belong to an id (and so are the same on every client that sees the id). */
export function identityFor(id: string): SessionIdentity {
  const hash = hashOf(id);
  return {
    id,
    name: `Guest ${1000 + (hash % 9000)}`,
    color: IDENTITY_COLORS[hash % IDENTITY_COLORS.length],
  };
}

export function createSessionIdentity(): SessionIdentity {
  return identityFor(crypto.randomUUID());
}

/**
 * The awareness state of a client (what `Awareness.setLocalState` holds), documented in
 * docs/specs/frontend.md. Every part but `user` is optional: a client that has not moved its pointer yet
 * has none.
 */
export interface PresenceState {
  readonly user: SessionIdentity;
  /** The pointer in scene coordinates, with the tool that made it (`laser` is Excalidraw's laser pointer). */
  readonly pointer?: { readonly x: number; readonly y: number; readonly tool: 'pointer' | 'laser' };
  readonly button?: 'up' | 'down';
  /** The ids of the elements this client has selected. */
  readonly selectedElementIds?: Readonly<Record<string, true>>;
}

/** The longest name shown next to a cursor. */
export const MAX_NAME_LENGTH = 40;

/**
 * The identity a host asks for with the `user-name` and `user-color` attributes, on top of the session's:
 * a blank name or a color that is not `#rrggbb` is ignored and the generated one stays.
 */
export function withHostIdentity(
  session: SessionIdentity,
  name: string | undefined,
  color: string | undefined,
): SessionIdentity {
  const trimmed = name?.trim().slice(0, MAX_NAME_LENGTH);
  return {
    id: session.id,
    name: trimmed || session.name,
    color: color && HEX_COLOR.test(color) ? color : session.color,
  };
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
