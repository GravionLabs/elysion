import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

export type CanvasStatus = 'loading' | 'ready' | 'error';

/** Spike (#125): what the presence list of #110 would look like next to the load status. */
export interface Collaborator {
  readonly clientId: number;
  readonly name: string;
  readonly color: string;
}

interface BoardState {
  status: CanvasStatus;
  collaborators: readonly Collaborator[];
}

export const BoardStore = signalStore(
  withState<BoardState>({ status: 'loading', collaborators: [] }),
  withComputed(({ status, collaborators }) => ({
    isReady: computed(() => status() === 'ready'),
    collaboratorCount: computed(() => collaborators().length),
  })),
  withMethods((store) => ({
    markReady: () => patchState(store, { status: 'ready' }),
    markError: () => patchState(store, { status: 'error' }),
    collaboratorJoined: (collaborator: Collaborator) =>
      patchState(store, (state) => ({
        collaborators: [
          ...state.collaborators.filter((c) => c.clientId !== collaborator.clientId),
          collaborator,
        ],
      })),
    collaboratorLeft: (clientId: number) =>
      patchState(store, (state) => ({
        collaborators: state.collaborators.filter((c) => c.clientId !== clientId),
      })),
  })),
);
