import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasApp } from './CanvasApp';

describe('CanvasApp', () => {
  it('renders the Excalidraw canvas', async () => {
    render(<CanvasApp boardId="test-board" />);

    expect(await screen.findByTestId('toolbar-rectangle')).toBeTruthy();
  });
});
