import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n';
import {
  DEFAULT_AGENDA_MINUTES,
  MAX_AGENDA_MINUTES,
  MAX_AGENDA_TITLE_LENGTH,
  MIN_AGENDA_MINUTES,
  addItem,
  currentItem,
  linkFrame,
  moveItem,
  plannedEnd,
  removeItem,
  renameItem,
  setDuration,
  spentOn,
  totalMinutes,
  type AgendaItem,
} from './agenda';
import { hasEnded, type TimerState } from './timer';

/** A frame of the board as the panel names it. */
export interface AgendaFrame {
  id: string;
  name: string | null;
}

export interface AgendaPanelProps {
  items: readonly AgendaItem[];
  /** The shared timer: the panel says when the current item's time is up. */
  timer: TimerState | null;
  /** A viewer sees the agenda and the current item, and changes nothing. */
  readOnly: boolean;
  /** The frames of the board by id: an item names its frame, or says it is gone. */
  frames: ReadonlyMap<string, string | null>;
  /** The frame that is selected on the board (one), for "Link to selected frame". */
  selectedFrame: AgendaFrame | null;
  /** A change of the list (editors). */
  onChange: (change: (items: AgendaItem[]) => AgendaItem[]) => void;
  /** "Start" on an item: it is current, the timer runs and everybody is brought to its frame. */
  onStart: (id: string) => void;
  /** "Next": the current item is done and the next one starts. */
  onNext: () => void;
  onClose: () => void;
  /** The clock; `Date.now` unless a test sets it. */
  now?: () => number;
  /** A new item's id; a random one unless a test sets it. */
  newId?: () => string;
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatSpent(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * The agenda of a workshop (#849): the items in order with their planned and spent time, the total and the planned end; the
 * current item is highlighted for everybody and announced. Editors add, rename, reorder (drag, the arrow buttons or
 * Alt+Arrow keys on an item), delete, set the minutes, link the selected frame, and run it with "Start" and "Next". A side
 * panel like the history: Esc closes it, the focus goes in when it opens and back when it closes.
 */
export function AgendaPanel({
  items,
  timer,
  readOnly,
  frames,
  selectedFrame,
  onChange,
  onStart,
  onNext,
  onClose,
  now = Date.now,
  newId = () => crypto.randomUUID(),
}: AgendaPanelProps) {
  const { t, locale } = useI18n();
  const headingId = useId();
  const hintId = useId();
  const newTitleId = useId();
  const newMinutesId = useId();
  const [draft, setDraft] = useState('');
  const [draftMinutes, setDraftMinutes] = useState(String(DEFAULT_AGENDA_MINUTES));
  const [dragging, setDragging] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Counts the seconds while an item runs, so that the panel is drawn again with the clock.
  const [, setTick] = useState(0);

  // The focus goes into the panel when it opens and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (firstField.current ?? closeButton.current)?.focus();
    return () => before?.focus?.();
  }, []);

  const current = currentItem(items);
  // While an item runs its spent time counts up and its timer may run out: the panel looks once a second.
  useEffect(() => {
    if (!current) return;
    const tick = window.setInterval(() => setTick((count) => count + 1), 1000);
    return () => window.clearInterval(tick);
  }, [current]);
  const clock = now();

  const timeUp = current !== null && timer !== null && hasEnded(timer, clock);
  const end = plannedEnd(items, clock);
  const through = items.length > 0 && items.every((item) => item.state === 'done');
  const canNext = items.some((item) => item.state === 'current' || item.state === 'pending');
  const clockTime = (time: number) =>
    new Date(time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim() === '') return;
    const minutes = Number(draftMinutes);
    onChange((list) => addItem(list, newId(), draft, minutes));
    setDraft('');
  };

  /** Moves an item and keeps the focus on the control that moved it. */
  const move = (id: string, to: number, focus?: string) => {
    onChange((list) => moveItem(list, id, to));
    if (focus) {
      // The same control again; a move button that the move disabled (the item is now first or last) hands over to the other.
      queueMicrotask(() => {
        for (const name of [focus, `up-${id}`, `down-${id}`]) {
          const control = listRef.current?.querySelector<HTMLInputElement>(
            `[data-agenda-control="${name}"]`,
          );
          if (control && !control.disabled) {
            control.focus();
            return;
          }
        }
      });
    }
  };

  const onItemKey = (event: KeyboardEvent, item: AgendaItem, index: number) => {
    if (readOnly || !event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const target = (event.target as HTMLElement).dataset['agendaControl'];
    move(item.id, index + (event.key === 'ArrowUp' ? -1 : 1), target);
  };

  const commitTitle = (item: AgendaItem, value: string) => {
    if (value.trim() === '' || value.trim() === item.title) return;
    onChange((list) => renameItem(list, item.id, value));
  };
  const commitMinutes = (item: AgendaItem, value: string) => {
    const minutes = Number(value);
    if (value.trim() === '' || !Number.isFinite(minutes) || minutes === item.durationMin) return;
    onChange((list) => setDuration(list, item.id, minutes));
  };

  const frameText = (frameId: string) => {
    if (!frames.has(frameId)) return t.agendaFrameGone;
    return t.agendaFrame(frames.get(frameId) || t.agendaUnnamedFrame);
  };

  const announcement = timeUp
    ? t.agendaTimeUp(current.title)
    : current
      ? t.agendaNow(current.title)
      : through
        ? t.agendaThrough
        : '';

  return (
    <aside
      className="elysion-agenda"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="elysion-agenda__header">
        <h2 id={headingId}>{t.agendaPanel}</h2>
        {!readOnly && (
          <button
            type="button"
            className="elysion-agenda__primary"
            disabled={!canNext}
            onClick={onNext}
          >
            {t.agendaNext}
          </button>
        )}
        <button
          ref={closeButton}
          type="button"
          className="elysion-comment-close"
          aria-label={t.agendaClose}
          title={t.agendaClose}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {/* Always there, so that a screen reader announces the current item and the end of its time (a polite live region). */}
      <div
        className={
          timeUp ? 'elysion-agenda__status elysion-agenda__status--up' : 'elysion-agenda__status'
        }
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      <div className="elysion-agenda__body">
        {items.length === 0 ? (
          <p className="elysion-agenda__empty">
            {readOnly ? t.agendaEmptyReadOnly : t.agendaEmpty}
          </p>
        ) : (
          <>
            {!readOnly && (
              <p id={hintId} className="elysion-agenda__hint">
                {t.agendaReorderHint}
              </p>
            )}
            <ol
              ref={listRef}
              className="elysion-agenda__list"
              aria-label={t.agendaItems}
              aria-describedby={readOnly ? undefined : hintId}
            >
              {items.map((item, index) => {
                const spent = spentOn(item, clock);
                return (
                  <li
                    key={item.id}
                    className={[
                      'elysion-agenda__item',
                      `elysion-agenda__item--${item.state}`,
                      dragging === item.id ? 'elysion-agenda__item--dragging' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-current={item.state === 'current' ? 'step' : undefined}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      setDragging(item.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => {
                      if (dragging) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragging && dragging !== item.id) move(dragging, index);
                      setDragging(null);
                    }}
                    onKeyDown={(event) => onItemKey(event, item, index)}
                  >
                    <div className="elysion-agenda__line">
                      <span className="elysion-agenda__number" aria-hidden="true">
                        {index + 1}.
                      </span>
                      {readOnly ? (
                        <strong className="elysion-agenda__title">{item.title}</strong>
                      ) : (
                        <input
                          key={`${item.id}:${item.title}`}
                          className="elysion-agenda__title"
                          type="text"
                          defaultValue={item.title}
                          maxLength={MAX_AGENDA_TITLE_LENGTH}
                          aria-label={t.agendaTitleOf(index + 1)}
                          autoComplete="off"
                          data-agenda-control={`title-${item.id}`}
                          onBlur={(event) => commitTitle(item, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') event.currentTarget.blur();
                          }}
                        />
                      )}
                      {item.state !== 'pending' && (
                        <span className="elysion-agenda__badge">
                          {item.state === 'current' ? t.agendaStateCurrent : t.agendaStateDone}
                        </span>
                      )}
                    </div>
                    <div className="elysion-agenda__meta">
                      {readOnly ? (
                        <span>{t.agendaPlanned(item.durationMin)}</span>
                      ) : (
                        <label className="elysion-agenda__minutes">
                          <input
                            key={`${item.id}:${item.durationMin}`}
                            type="number"
                            min={MIN_AGENDA_MINUTES}
                            max={MAX_AGENDA_MINUTES}
                            step={1}
                            defaultValue={item.durationMin}
                            aria-label={t.agendaMinutesOf(item.title)}
                            onBlur={(event) => commitMinutes(item, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                          />
                          <span aria-hidden="true">{t.agendaPlannedUnit}</span>
                        </label>
                      )}
                      {(item.state !== 'pending' || spent > 0) && (
                        <span className="elysion-agenda__spent">
                          {t.agendaSpent(formatSpent(spent))}
                        </span>
                      )}
                    </div>
                    {item.frameId && (
                      <div className="elysion-agenda__frame">
                        <span>{frameText(item.frameId)}</span>
                        {!readOnly && (
                          <button
                            type="button"
                            className="elysion-agenda__icon"
                            aria-label={t.agendaUnlinkOf(item.title)}
                            title={t.agendaUnlinkOf(item.title)}
                            onClick={() => onChange((list) => linkFrame(list, item.id, null))}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )}
                    {!readOnly && (
                      <div className="elysion-agenda__actions">
                        <button
                          type="button"
                          className="elysion-agenda__primary"
                          aria-label={t.agendaStartOf(item.title)}
                          disabled={item.state === 'current'}
                          onClick={() => onStart(item.id)}
                        >
                          {t.agendaStart}
                        </button>
                        <button
                          type="button"
                          aria-label={t.agendaLinkFrameOf(item.title)}
                          title={
                            selectedFrame ? t.agendaLinkFrameOf(item.title) : t.agendaLinkNeedsFrame
                          }
                          disabled={!selectedFrame || selectedFrame.id === item.frameId}
                          onClick={() =>
                            selectedFrame &&
                            onChange((list) => linkFrame(list, item.id, selectedFrame.id))
                          }
                        >
                          {t.agendaLinkFrame}
                        </button>
                        <button
                          type="button"
                          className="elysion-agenda__icon"
                          aria-label={t.agendaMoveUpOf(item.title)}
                          title={t.agendaMoveUpOf(item.title)}
                          data-agenda-control={`up-${item.id}`}
                          disabled={index === 0}
                          onClick={() => move(item.id, index - 1, `up-${item.id}`)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="elysion-agenda__icon"
                          aria-label={t.agendaMoveDownOf(item.title)}
                          title={t.agendaMoveDownOf(item.title)}
                          data-agenda-control={`down-${item.id}`}
                          disabled={index === items.length - 1}
                          onClick={() => move(item.id, index + 1, `down-${item.id}`)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="elysion-agenda__icon"
                          aria-label={t.agendaDeleteOf(item.title)}
                          title={t.agendaDeleteOf(item.title)}
                          onClick={() => {
                            onChange((list) => removeItem(list, item.id));
                            queueMicrotask(() => closeButton.current?.focus());
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
      <footer className="elysion-agenda__footer">
        <p className="elysion-agenda__total">
          {[t.agendaTotal(totalMinutes(items)), end === null ? null : t.agendaEnds(clockTime(end))]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {!readOnly && (
          <form className="elysion-agenda__new" onSubmit={add}>
            <div className="elysion-agenda__field">
              <label htmlFor={newTitleId}>{t.agendaNewLabel}</label>
              <input
                ref={firstField}
                id={newTitleId}
                type="text"
                value={draft}
                maxLength={MAX_AGENDA_TITLE_LENGTH}
                placeholder={t.agendaNewPlaceholder}
                autoComplete="off"
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            <div className="elysion-agenda__field elysion-agenda__field--minutes">
              <label htmlFor={newMinutesId}>{t.agendaNewMinutes}</label>
              <input
                id={newMinutesId}
                type="number"
                min={MIN_AGENDA_MINUTES}
                max={MAX_AGENDA_MINUTES}
                step={1}
                value={draftMinutes}
                onChange={(event) => setDraftMinutes(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className="elysion-agenda__primary"
              disabled={draft.trim() === ''}
            >
              {t.agendaAdd}
            </button>
          </form>
        )}
      </footer>
    </aside>
  );
}
