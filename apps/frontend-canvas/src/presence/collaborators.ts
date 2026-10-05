import type { Collaborator, SocketId } from '@excalidraw/excalidraw/types';
import { HEX_COLOR, IDENTITY_COLORS, MAX_NAME_LENGTH, type PresenceState } from './identity';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isIdentity(value: unknown): value is PresenceState['user'] {
  const user = value as Partial<PresenceState['user']> | null;
  return (
    typeof user?.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.color === 'string' &&
    user.id !== ''
  );
}

function pointerOf(value: unknown): Collaborator['pointer'] {
  const pointer = value as { x?: unknown; y?: unknown; tool?: unknown } | null;
  if (!isNumber(pointer?.x) || !isNumber(pointer?.y)) {
    return undefined;
  }
  return { x: pointer.x, y: pointer.y, tool: pointer.tool === 'laser' ? 'laser' : 'pointer' };
}

function selectionOf(value: unknown): Collaborator['selectedElementIds'] {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const ids = Object.keys(value).filter((id) => (value as Record<string, unknown>)[id] === true);
  return Object.fromEntries(ids.map((id) => [id, true as const]));
}

/**
 * Excalidraw's `collaborators` from the awareness states of a board: one entry per other client with a
 * valid identity, keyed by its awareness client id. The local client is left out (Excalidraw draws the
 * own cursor itself), and so is a state that is not in the documented shape, because the states come
 * from other browsers and may hold anything. Outdated clients are not seen here: the `Awareness` removes
 * a client whose state has not been renewed for 30 s, which is a change like any other.
 */
export function toCollaborators(
  states: ReadonlyMap<number, unknown>,
  localClientId: number,
): Map<SocketId, Collaborator> {
  const collaborators = new Map<SocketId, Collaborator>();
  for (const [clientId, raw] of states) {
    const state = raw as Partial<PresenceState> | null;
    if (clientId === localClientId || !isIdentity(state?.user)) {
      continue;
    }
    const { user } = state;
    // Anything that is not a color of the palette would be drawn as given; only hex colors pass.
    const accent = HEX_COLOR.test(user.color) ? user.color : IDENTITY_COLORS[0];
    collaborators.set(String(clientId) as SocketId, {
      id: user.id,
      username: user.name.slice(0, MAX_NAME_LENGTH),
      color: { background: accent, stroke: accent },
      pointer: pointerOf(state.pointer),
      button: state.button === 'down' ? 'down' : 'up',
      selectedElementIds: selectionOf(state.selectedElementIds),
    });
  }
  return collaborators;
}

/** One other client on the board, as the shell is told about it. */
export interface PresentUser {
  id: string;
  name: string;
  color: string;
}

/**
 * The other clients with a valid identity (the same rules as `toCollaborators`), ordered by name and id so
 * the list only changes when somebody comes or goes or renames, not when somebody moves the pointer.
 */
export function presentUsers(
  states: ReadonlyMap<number, unknown>,
  localClientId: number,
): PresentUser[] {
  const users: PresentUser[] = [];
  for (const [clientId, raw] of states) {
    const user = (raw as Partial<PresenceState> | null)?.user;
    if (clientId === localClientId || !isIdentity(user)) {
      continue;
    }
    users.push({
      id: user.id,
      name: user.name.slice(0, MAX_NAME_LENGTH),
      color: HEX_COLOR.test(user.color) ? user.color : IDENTITY_COLORS[0],
    });
  }
  return users.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
