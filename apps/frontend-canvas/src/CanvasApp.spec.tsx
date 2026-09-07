import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasApp } from './CanvasApp';

describe('CanvasApp', () => {
  it('renders the tldraw canvas', async () => {
    render(<CanvasApp boardId="test-board" />);

    expect(await screen.findByRole('application')).toBeTruthy();
  });
});
