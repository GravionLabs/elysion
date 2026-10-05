import { useState, type ReactNode } from 'react';
import type { ToolType } from '@excalidraw/excalidraw/types';
import { STICKY_COLORS, type StickyColor } from './sticky-note';

export type ToolbarTool = Extract<
  ToolType,
  | 'selection'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'eraser'
>;

interface ToolDefinition {
  tool: ToolbarTool;
  label: string;
  shortcut: string;
  icon: ReactNode;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GROUPS: readonly (readonly ToolDefinition[])[] = [
  [
    {
      tool: 'hand',
      label: 'Hand (panning)',
      shortcut: 'H',
      icon: (
        <Icon>
          <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14" />
        </Icon>
      ),
    },
    {
      tool: 'selection',
      label: 'Selection',
      shortcut: 'V',
      icon: (
        <Icon>
          <path d="m5 3 14 8-6 2-2 6z" />
        </Icon>
      ),
    },
  ],
  [
    {
      tool: 'rectangle',
      label: 'Rectangle',
      shortcut: 'R',
      icon: (
        <Icon>
          <rect x="4" y="5" width="16" height="14" rx="2" />
        </Icon>
      ),
    },
    {
      tool: 'diamond',
      label: 'Diamond',
      shortcut: 'D',
      icon: (
        <Icon>
          <path d="M12 3 21 12 12 21 3 12z" />
        </Icon>
      ),
    },
    {
      tool: 'ellipse',
      label: 'Ellipse',
      shortcut: 'O',
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="8" />
        </Icon>
      ),
    },
  ],
  [
    {
      tool: 'arrow',
      label: 'Arrow',
      shortcut: 'A',
      icon: (
        <Icon>
          <path d="M5 19 19 5m0 0H9m10 0v10" />
        </Icon>
      ),
    },
    {
      tool: 'line',
      label: 'Line',
      shortcut: 'L',
      icon: (
        <Icon>
          <path d="M5 19 19 5" />
        </Icon>
      ),
    },
    {
      tool: 'freedraw',
      label: 'Draw',
      shortcut: 'P',
      icon: (
        <Icon>
          <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
        </Icon>
      ),
    },
  ],
  [
    {
      tool: 'text',
      label: 'Text',
      shortcut: 'T',
      icon: (
        <Icon>
          <path d="M5 6V4h14v2M12 4v16m-3 0h6" />
        </Icon>
      ),
    },
    {
      tool: 'image',
      label: 'Insert image',
      shortcut: '9',
      icon: (
        <Icon>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m4 18 5-5 4 4 3-3 4 4" />
        </Icon>
      ),
    },
  ],
  [
    {
      tool: 'eraser',
      label: 'Eraser',
      shortcut: 'E',
      icon: (
        <Icon>
          <path d="m7 20-3.5-3.5a2 2 0 0 1 0-2.8L14 3.2a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11 20zm-2-8 7 7" />
        </Icon>
      ),
    },
  ],
];

export type ZoomAction = 'in' | 'out' | 'reset' | 'fit';
export type HistoryAction = 'undo' | 'redo';

export interface ToolbarProps {
  activeTool: ToolType | 'custom';
  onSelect: (tool: ToolbarTool) => void;
  onAddSticky?: (color: StickyColor) => void;
  /** Undo and redo; the buttons are only shown when this is given. */
  onHistory?: (action: HistoryAction) => void;
  /** Zoom out, in, back to 100% and fit to content; shown together with `zoomPercent`. */
  onZoom?: (action: ZoomAction) => void;
  /** The current zoom in percent, shown on the reset button. */
  zoomPercent?: number;
}

const UNDO_ICON = (
  <Icon>
    <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);
const REDO_ICON = (
  <Icon>
    <path d="m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h3" />
  </Icon>
);
const ZOOM_OUT_ICON = (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
const ZOOM_IN_ICON = (
  <Icon>
    <path d="M5 12h14M12 5v14" />
  </Icon>
);
const FIT_ICON = (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

const STICKY_ICON = (
  <Icon>
    <path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 20v-5a1 1 0 0 1 1-1h5" />
  </Icon>
);

/** The bottom-centered floating tool pill, styled after ariadne's toolbox. */
export function Toolbar({
  activeTool,
  onSelect,
  onAddSticky,
  onHistory,
  onZoom,
  zoomPercent,
}: ToolbarProps) {
  const [stickyOpen, setStickyOpen] = useState(false);

  return (
    <div className="elysion-toolbar" role="toolbar" aria-label="Canvas tools">
      {onHistory && (
        <div className="elysion-toolbar__group elysion-toolbar__history">
          <button
            type="button"
            className="elysion-icon-button"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            data-testid="elysion-undo"
            onClick={() => onHistory('undo')}
          >
            {UNDO_ICON}
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            data-testid="elysion-redo"
            onClick={() => onHistory('redo')}
          >
            {REDO_ICON}
          </button>
        </div>
      )}
      {GROUPS.map((group, index) => (
        <div className="elysion-toolbar__group" key={group[0].tool}>
          {(index > 0 || onHistory) && <div className="elysion-toolbar__divider" />}
          {group.map(({ tool, label, shortcut, icon }) => {
            const active = activeTool === tool;
            return (
              <button
                key={tool}
                type="button"
                className={active ? 'elysion-icon-button active' : 'elysion-icon-button'}
                aria-label={label}
                aria-pressed={active}
                title={`${label} (${shortcut})`}
                data-testid={`elysion-tool-${tool}`}
                onClick={() => onSelect(tool)}
              >
                {icon}
              </button>
            );
          })}
          {onAddSticky && group.some((d) => d.tool === 'text') && (
            <div className="elysion-sticky">
              <button
                type="button"
                className={stickyOpen ? 'elysion-icon-button active' : 'elysion-icon-button'}
                aria-label="Sticky note"
                aria-haspopup="true"
                aria-expanded={stickyOpen}
                title="Sticky note"
                data-testid="elysion-tool-sticky"
                onClick={() => setStickyOpen((open) => !open)}
              >
                {STICKY_ICON}
              </button>
              {stickyOpen && (
                <div className="elysion-sticky__colors" role="group" aria-label="Sticky note color">
                  {STICKY_COLORS.map((color) => (
                    <button
                      key={color.name}
                      type="button"
                      className="elysion-sticky__swatch"
                      style={{ background: color.hex }}
                      aria-label={`${color.name} sticky note`}
                      title={`${color.name} sticky note`}
                      onClick={() => {
                        onAddSticky(color);
                        setStickyOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {onZoom && (
        <div className="elysion-toolbar__group">
          <div className="elysion-toolbar__divider" />
          <button
            type="button"
            className="elysion-icon-button"
            aria-label="Zoom out"
            title="Zoom out (Ctrl+-)"
            data-testid="elysion-zoom-out"
            onClick={() => onZoom('out')}
          >
            {ZOOM_OUT_ICON}
          </button>
          <button
            type="button"
            className="elysion-zoom-level"
            aria-label="Reset zoom to 100%"
            title="Reset zoom (Ctrl+0)"
            data-testid="elysion-zoom-reset"
            onClick={() => onZoom('reset')}
          >
            {zoomPercent ?? 100}%
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label="Zoom in"
            title="Zoom in (Ctrl++)"
            data-testid="elysion-zoom-in"
            onClick={() => onZoom('in')}
          >
            {ZOOM_IN_ICON}
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label="Zoom to fit"
            title="Zoom to fit (Shift+1)"
            data-testid="elysion-zoom-fit"
            onClick={() => onZoom('fit')}
          >
            {FIT_ICON}
          </button>
        </div>
      )}
    </div>
  );
}
