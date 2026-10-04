import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasApp } from './CanvasApp';

describe('sticky notes', () => {
  it('inserts a note per click without hanging', async () => {
    render(<CanvasApp boardId="test-board" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Selection' })).toBeTruthy());

    for (const color of ['Amber', 'Teal']) {
      fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
      fireEvent.click(screen.getByRole('button', { name: `${color} sticky note` }));
      await waitFor(() =>
        expect(screen.queryByRole('group', { name: 'Sticky note color' })).toBeNull(),
      );
    }
  }, 15000);
});
