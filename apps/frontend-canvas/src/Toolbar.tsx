import { useState, type ReactNode } from 'react';
import type { ToolType } from '@excalidraw/excalidraw/types';
import { colorName, useI18n } from './i18n';
import { CanvasMenu, type CanvasMenuItem } from './CanvasMenu';
import { STICKY_COLORS, borderColor, paperColor, seenColor, type StickyColor } from './sticky-note';

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
  label: ToolLabelKey;
  shortcut: string;
  icon: ReactNode;
}

type ToolLabelKey =
  | 'toolHand'
  | 'toolSelection'
  | 'toolRectangle'
  | 'toolDiamond'
  | 'toolEllipse'
  | 'toolArrow'
  | 'toolLine'
  | 'toolFreedraw'
  | 'toolText'
  | 'toolImage'
  | 'toolEraser';

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
      label: 'toolHand',
      shortcut: 'H',
      icon: (
        <Icon>
          <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.7-2.3L4 14.5a1.6 1.6 0 0 1 2.5-2L8 14" />
        </Icon>
      ),
    },
    {
      tool: 'selection',
      label: 'toolSelection',
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
      label: 'toolRectangle',
      shortcut: 'R',
      icon: (
        <Icon>
          <rect x="4" y="5" width="16" height="14" rx="2" />
        </Icon>
      ),
    },
    {
      tool: 'diamond',
      label: 'toolDiamond',
      shortcut: 'D',
      icon: (
        <Icon>
          <path d="M12 3 21 12 12 21 3 12z" />
        </Icon>
      ),
    },
    {
      tool: 'ellipse',
      label: 'toolEllipse',
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
      label: 'toolArrow',
      shortcut: 'A',
      icon: (
        <Icon>
          <path d="M5 19 19 5m0 0H9m10 0v10" />
        </Icon>
      ),
    },
    {
      tool: 'line',
      label: 'toolLine',
      shortcut: 'L',
      icon: (
        <Icon>
          <path d="M5 19 19 5" />
        </Icon>
      ),
    },
    {
      tool: 'freedraw',
      label: 'toolFreedraw',
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
      label: 'toolText',
      shortcut: 'T',
      icon: (
        <Icon>
          <path d="M5 6V4h14v2M12 4v16m-3 0h6" />
        </Icon>
      ),
    },
    {
      tool: 'image',
      label: 'toolImage',
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
      label: 'toolEraser',
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
  /** Makes a note in a color; the button is only shown when this is given. */
  onAddSticky?: (color: StickyColor) => void;
  /** The color the next note gets (the one used last): the button's icon shows it and one click makes such a note. */
  stickyColor?: StickyColor;
  /** The theme of the canvas: the sticky note colors are shown as they are seen in it. */
  theme?: 'light' | 'dark';
  /** Undo and redo; the buttons are only shown when this is given. */
  onHistory?: (action: HistoryAction) => void;
  /** Connects the two selected elements; the button is only shown when this is given. */
  onConnect?: () => void;
  /** Zoom out, in, back to 100% and fit to content; shown together with `zoomPercent`. */
  onZoom?: (action: ZoomAction) => void;
  /** The current zoom in percent, shown on the reset button. */
  zoomPercent?: number;
  /** What the canvas menu at the end of the toolbar lists; without items there is no menu. */
  menuItems?: readonly CanvasMenuItem[];
  /** A viewer: no tools, no undo and redo, no sticky notes; only the zoom is shown. */
  readOnly?: boolean;
  /**
   * Whether the image tool is offered. Off by default: without a file store the image would be seen by its author
   * only and be gone after a reload (see `docs/specs/frontend.md`, "Board files").
   */
  imagesEnabled?: boolean;
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

/**
 * A sticky note in a color: its paper with the darker border, and the folded corner, in the color the note really has
 * on the canvas in this theme (the dark theme darkens the canvas), so the menu and the note drawn look the same.
 */
function StickyIcon({ color, theme }: { color: StickyColor; theme: 'light' | 'dark' }) {
  const paper = seenColor(paperColor(color), theme);
  const border = seenColor(borderColor(color), theme);
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
        fill={paper}
        stroke={border}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 20v-5a1 1 0 0 1 1-1h5"
        fill="none"
        stroke={border}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CONNECT_ICON = (
  <Icon>
    <circle cx="5" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
    <path d="M7 12h10" />
  </Icon>
);

/** The bottom-centered floating tool pill, styled after ariadne's toolbox. */
export function Toolbar({
  activeTool,
  onSelect,
  onAddSticky,
  stickyColor = STICKY_COLORS[0],
  theme = 'light',
  onHistory,
  onConnect,
  onZoom,
  zoomPercent,
  menuItems,
  readOnly = false,
  imagesEnabled = false,
}: ToolbarProps) {
  const [stickyOpen, setStickyOpen] = useState(false);
  const { t, percent } = useI18n();
  const ctrl = t.keyCtrl;

  return (
    <div className="elysion-toolbar" role="toolbar" aria-label={t.toolbar}>
      {!readOnly && onHistory && (
        <div className="elysion-toolbar__group elysion-toolbar__history">
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.undo}
            title={`${t.undo} (${ctrl}+Z)`}
            data-testid="elysion-undo"
            onClick={() => onHistory('undo')}
          >
            {UNDO_ICON}
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.redo}
            title={`${t.redo} (${ctrl}+${t.keyShift}+Z)`}
            data-testid="elysion-redo"
            onClick={() => onHistory('redo')}
          >
            {REDO_ICON}
          </button>
        </div>
      )}
      {!readOnly && onConnect && (
        <div className="elysion-toolbar__group">
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.connect}
            title={`${t.connectTitle} (C)`}
            data-testid="elysion-connect"
            onClick={onConnect}
          >
            {CONNECT_ICON}
          </button>
        </div>
      )}
      {/* A viewer cannot draw: only the zoom stays. */}
      {(readOnly ? [] : GROUPS).map((group, index) => (
        <div className="elysion-toolbar__group" key={group[0].tool}>
          {(index > 0 || onHistory) && <div className="elysion-toolbar__divider" />}
          {group
            .filter(({ tool }) => imagesEnabled || tool !== 'image')
            .map(({ tool, label: labelKey, shortcut, icon }) => {
              const label = t[labelKey];
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
              {/* Split button: the main part makes a note in the current color at once, the arrow picks another. */}
              <button
                type="button"
                className="elysion-icon-button elysion-sticky__main"
                aria-label={t.stickyNote}
                title={`${t.stickyNote} (N)`}
                data-testid="elysion-tool-sticky"
                onClick={() => onAddSticky(stickyColor)}
              >
                <StickyIcon color={stickyColor} theme={theme} />
              </button>
              <button
                type="button"
                className={
                  stickyOpen
                    ? 'elysion-icon-button elysion-sticky__arrow active'
                    : 'elysion-icon-button elysion-sticky__arrow'
                }
                aria-label={t.stickyNoteColor}
                aria-haspopup="menu"
                aria-expanded={stickyOpen}
                title={t.stickyNoteColor}
                data-testid="elysion-sticky-color"
                onClick={() => setStickyOpen((open) => !open)}
              >
                <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true" focusable="false">
                  <path
                    d="M2 3.5 5 6.5 8 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                </svg>
              </button>
              {stickyOpen && (
                <div className="elysion-sticky__colors" role="menu" aria-label={t.stickyNoteColor}>
                  {STICKY_COLORS.map((color) => (
                    <button
                      key={color.name}
                      type="button"
                      role="menuitemradio"
                      aria-checked={color.name === stickyColor.name}
                      className="elysion-sticky__swatch"
                      aria-label={t.stickyNoteOf(colorName(t, color.name))}
                      title={t.stickyNoteOf(colorName(t, color.name))}
                      onClick={() => {
                        onAddSticky(color);
                        setStickyOpen(false);
                      }}
                    >
                      <StickyIcon color={color} theme={theme} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {onZoom && (
        <div className="elysion-toolbar__group">
          {!readOnly && <div className="elysion-toolbar__divider" />}
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.zoomOut}
            title={`${t.zoomOut} (${ctrl}+-)`}
            data-testid="elysion-zoom-out"
            onClick={() => onZoom('out')}
          >
            {ZOOM_OUT_ICON}
          </button>
          <button
            type="button"
            className="elysion-zoom-level"
            aria-label={t.zoomResetLabel}
            title={`${t.zoomReset} (${ctrl}+0)`}
            data-testid="elysion-zoom-reset"
            onClick={() => onZoom('reset')}
          >
            {percent((zoomPercent ?? 100) / 100)}
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.zoomIn}
            title={`${t.zoomIn} (${ctrl}++)`}
            data-testid="elysion-zoom-in"
            onClick={() => onZoom('in')}
          >
            {ZOOM_IN_ICON}
          </button>
          <button
            type="button"
            className="elysion-icon-button"
            aria-label={t.zoomFit}
            title={`${t.zoomFit} (${t.keyShift}+1)`}
            data-testid="elysion-zoom-fit"
            onClick={() => onZoom('fit')}
          >
            {FIT_ICON}
          </button>
        </div>
      )}
      {menuItems && menuItems.length > 0 && (
        <div className="elysion-toolbar__group">
          <div className="elysion-toolbar__divider" />
          <CanvasMenu items={menuItems} />
        </div>
      )}
    </div>
  );
}
