import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Waits until Excalidraw has finished loading. Its toolbar is in the DOM before that, but until then
 * it neither reports changes (`onChange`) nor reliably reacts to keys, so a test that presses a
 * shortcut right after the toolbar appears races the load (it failed about one run in four when the
 * other workspaces' tests ran in parallel).
 */
export async function excalidrawReady(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector('.LoadingMessage')).toBeNull();
    expect(container.querySelector('canvas.interactive')).toBeTruthy();
  });
}
