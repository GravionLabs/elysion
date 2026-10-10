import { describe, expect, it } from 'vitest';
import { replaceRenderGrid } from '../vite-plugin-excalidraw-no-grid';

describe('replaceRenderGrid', () => {
  it('switches off the call in the development build and in the minified one', () => {
    expect(
      replaceRenderGrid('{isExporting: false, renderGrid: isGridModeEnabled(this), x: 1}'),
    ).toBe('{isExporting: false, renderGrid:false, x: 1}');
    expect(
      replaceRenderGrid('{imageCache:this.imageCache,isExporting:!1,renderGrid:gn(this)}'),
    ).toBe('{imageCache:this.imageCache,isExporting:!1,renderGrid:false}');
  });

  it('leaves the exporting call alone and reports a library without the call', () => {
    expect(replaceRenderGrid('{renderGrid: false}')).toBeNull();
    expect(replaceRenderGrid('nothing here')).toBeNull();
  });
});
