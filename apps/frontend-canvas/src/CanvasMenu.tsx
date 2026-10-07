import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** What the canvas menu lists. The menu only draws these; what an item does is up to whoever made it. */
export type CanvasMenuItem =
  | { type: 'heading'; label: string }
  | {
      type: 'item';
      id: string;
      label: string;
      /** Shown on the right, e.g. a shortcut. */
      hint?: string;
      onSelect: () => void;
      /** Asks first: choosing the item shows the question with the two answers instead of acting at once. */
      confirm?: { message: string; accept: string; decline: string };
      disabled?: boolean;
    }
  | {
      type: 'check';
      id: string;
      label: string;
      checked: boolean;
      onSelect: () => void;
      disabled?: boolean;
    }
  | {
      type: 'radio';
      id: string;
      label: string;
      checked: boolean;
      onSelect: () => void;
      /** Stays open after choosing, so that a size can be tried out. */
      keepOpen?: boolean;
    };

const DOTS_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

interface CanvasMenuProps {
  items: readonly CanvasMenuItem[];
  /** Extra content under the items (none yet). */
  footer?: ReactNode;
}

/**
 * The menu at the end of the toolbar, where Excalidraw's hamburger used to be. A button that opens a list above the
 * toolbar; it closes on Escape, on a click outside and after an item (radio items may keep it open). Arrow keys move
 * between items, Home and End jump to the first and last.
 */
export function CanvasMenu({ items, footer }: CanvasMenuProps) {
  const [open, setOpen] = useState(false);
  // The item whose confirmation is showing, if any.
  const [asking, setAsking] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    setAsking(null);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setAsking(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // When it opens, and when the list turns into the question and back, the first thing to act on has the focus.
  const view = asking ? 'question' : 'list';
  useEffect(() => {
    if (!open) return;
    const first = view === 'question' ? '[data-ask]' : '[role^="menuitem"]';
    rootRef.current?.querySelector<HTMLElement>(first)?.focus();
  }, [open, view]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    const focusable = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>(
        '[role^="menuitem"]:not([aria-disabled="true"]), [data-ask]',
      ) ?? []),
    ];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const target =
      event.key === 'ArrowDown'
        ? focusable[(index + 1) % focusable.length]
        : event.key === 'ArrowUp'
          ? focusable[(index - 1 + focusable.length) % focusable.length]
          : event.key === 'Home'
            ? focusable[0]
            : event.key === 'End'
              ? focusable[focusable.length - 1]
              : undefined;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  const question = items.find(
    (item): item is Extract<CanvasMenuItem, { type: 'item' }> =>
      item.type === 'item' && item.id === asking && !!item.confirm,
  );

  return (
    <div className="elysion-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'elysion-icon-button active' : 'elysion-icon-button'}
        aria-label="Canvas menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Canvas menu"
        data-testid="elysion-menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {DOTS_ICON}
      </button>
      {open && (
        <div
          id={menuId}
          className="elysion-menu__list"
          role="menu"
          aria-label="Canvas menu"
          onKeyDown={onKeyDown}
        >
          {question?.confirm ? (
            <div className="elysion-menu__question" role="group" aria-label={question.label}>
              <p>{question.confirm.message}</p>
              <button
                type="button"
                data-ask="accept"
                className="elysion-menu__button elysion-menu__button--danger"
                onClick={() => {
                  close();
                  question.onSelect();
                }}
              >
                {question.confirm.accept}
              </button>
              <button
                type="button"
                data-ask="decline"
                className="elysion-menu__button"
                onClick={() => setAsking(null)}
              >
                {question.confirm.decline}
              </button>
            </div>
          ) : (
            items.map((item, index) => {
              if (item.type === 'heading') {
                return (
                  <div key={`h-${index}`} className="elysion-menu__heading" role="presentation">
                    {item.label}
                  </div>
                );
              }
              const role =
                item.type === 'check'
                  ? 'menuitemcheckbox'
                  : item.type === 'radio'
                    ? 'menuitemradio'
                    : 'menuitem';
              const disabled = 'disabled' in item && item.disabled;
              return (
                <button
                  key={item.id}
                  type="button"
                  role={role}
                  className="elysion-menu__item"
                  aria-checked={item.type === 'item' ? undefined : item.checked}
                  aria-disabled={disabled || undefined}
                  tabIndex={-1}
                  onClick={() => {
                    if (disabled) return;
                    if (item.type === 'item' && item.confirm) {
                      setAsking(item.id);
                      return;
                    }
                    item.onSelect();
                    if (!(item.type === 'radio' && item.keepOpen)) close();
                  }}
                >
                  {item.type !== 'item' && (
                    <span className="elysion-menu__mark" aria-hidden="true">
                      {item.checked ? (item.type === 'radio' ? '●' : '✓') : ''}
                    </span>
                  )}
                  <span className="elysion-menu__label">{item.label}</span>
                  {item.type === 'item' && item.hint && (
                    <span className="elysion-menu__hint">{item.hint}</span>
                  )}
                </button>
              );
            })
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
