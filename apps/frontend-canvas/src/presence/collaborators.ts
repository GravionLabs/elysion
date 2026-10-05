import type { Collaborator, SocketId } from '@excalidraw/excalidraw/types';
import { IDENTITY_COLORS, type PresenceState } from './identity';

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
    const accent = /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : IDENTITY_COLORS[0];
    collaborators.set(String(clientId) as SocketId, {
      id: user.id,
      username: user.name.slice(0, 40),
      color: { background: accent, stroke: accent },
      pointer: pointerOf(state.pointer),
      button: state.button === 'down' ? 'down' : 'up',
      selectedElementIds: selectionOf(state.selectedElementIds),
    });
  }
  return collaborators;
}
