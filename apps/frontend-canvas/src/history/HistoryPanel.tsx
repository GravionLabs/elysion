import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n, type Messages } from '../i18n';
import {
  MAX_SNAPSHOT_NAME_LENGTH,
  formatSize,
  groupByDay,
  type SnapshotApi,
  type SnapshotInfo,
} from './history';
import { renderSnapshotPreview } from './snapshot-preview';

export interface HistoryPanelProps {
  api: SnapshotApi;
  /** A viewer only looks: no "Save version", no renaming. */
  readOnly: boolean;
  /** Owners delete versions. */
  canDelete: boolean;
  onClose: () => void;
}

/** What went wrong in words, by the HTTP status the host's API rejected with (see {@link SnapshotApi}). */
function problemText(error: unknown, fallback: string, t: Messages): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 403) return t.historyForbidden;
  if (status === 409) return t.historyConflict;
  if (status === 503) return t.historyUnavailable;
  return fallback;
}

function titleOf(snapshot: SnapshotInfo, t: Messages): string {
  if (snapshot.name) return snapshot.name;
  return snapshot.kind === 'Auto'
    ? t.historyKindAuto
    : snapshot.kind === 'BeforeRestore'
      ? t.historyKindBeforeRestore
      : t.historyKindManual;
}

/**
 * The history of a board (#846, ADR 0032): the versions grouped by day, newest first, with "Save version" (a name is
 * optional), a preview picture drawn from each version, and rename and delete by role. A side panel like the comments; it
 * works with the keyboard (Esc closes it, the focus returns to where it was) and every control has a name.
 */
export function HistoryPanel({ api, readOnly, canDelete, onClose }: HistoryPanelProps) {
  const { t, locale } = useI18n();
  const headingId = useId();
  const nameId = useId();
  const [items, setItems] = useState<SnapshotInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const previewsRef = useRef<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  const gone = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // The focus goes into the panel when it opens and back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    (saveButton.current ?? closeButton.current)?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      for (const url of Object.values(previewsRef.current)) if (url) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    let current = true;
    api
      .list()
      .then((list) => current && setItems(list))
      .catch((error: unknown) => {
        if (!current) return;
        setItems([]);
        setProblem(problemText(error, t.historyLoadFailed, t));
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Previews are drawn one after the other, newest first, so the first screen fills first and the page stays responsive.
  useEffect(() => {
    if (!items) return;
    const next = items.find((item) => !requested.current.has(item.id));
    if (!next) return;
    requested.current.add(next.id);
    void (async () => {
      let url: string | null = null;
      try {
        const blob = await renderSnapshotPreview(await api.document(next.id));
        if (blob) url = URL.createObjectURL(blob);
      } catch {
        url = null;
      }
      if (gone.current) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      previewsRef.current = { ...previewsRef.current, [next.id]: url };
      setPreviews(previewsRef.current);
    })();
  }, [items, previews, api]);

  const groups = useMemo(
    () =>
      groupByDay(items ?? [], new Date(), (day) =>
        day === 'today'
          ? t.historyToday
          : day === 'yesterday'
            ? t.historyYesterday
            : day.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: day.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
              }),
      ),
    [items, t, locale],
  );

  const time = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const created = await api.create(draft.trim() || undefined);
      if (gone.current) return;
      setItems((list) => [created, ...(list ?? [])]);
      setNaming(false);
      setDraft('');
      queueMicrotask(() => saveButton.current?.focus());
    } catch (error) {
      if (!gone.current) setProblem(problemText(error, t.historySaveFailed, t));
    } finally {
      if (!gone.current) setBusy(false);
    }
  };

  const rename = async (event: FormEvent, snapshot: SnapshotInfo) => {
    event.preventDefault();
    const name = renameDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const renamed = await api.rename(snapshot.id, name);
      if (gone.current) return;
      setItems((list) => (list ?? []).map((item) => (item.id === snapshot.id ? renamed : item)));
      setRenaming(null);
    } catch (error) {
      if (!gone.current) setProblem(problemText(error, t.historyRenameFailed, t));
    } finally {
      if (!gone.current) setBusy(false);
    }
  };

  const remove = async (snapshot: SnapshotInfo) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.remove(snapshot.id);
      if (gone.current) return;
      setItems((list) => (list ?? []).filter((item) => item.id !== snapshot.id));
      setAsking(null);
      queueMicrotask(() => closeButton.current?.focus());
    } catch (error) {
      if (!gone.current) setProblem(problemText(error, t.historyDeleteFailed, t));
    } finally {
      if (!gone.current) setBusy(false);
    }
  };

  return (
    <aside
      className="elysion-history"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.stopPropagation();
        // Esc first leaves a form or question that is open, then the panel.
        if (naming || renaming || asking) {
          setNaming(false);
          setRenaming(null);
          setAsking(null);
        } else onClose();
      }}
    >
      <header className="elysion-history__header">
        <h2 id={headingId}>{t.historyPanel}</h2>
        {!readOnly && (
          <button
            ref={saveButton}
            type="button"
            className="elysion-history__primary"
            aria-expanded={naming}
            onClick={() => setNaming((open) => !open)}
          >
            {t.historySave}
          </button>
        )}
        <button
          ref={closeButton}
          type="button"
          className="elysion-comment-close"
          aria-label={t.historyClose}
          title={t.historyClose}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {naming && (
        <form className="elysion-history__name" onSubmit={(event) => void save(event)}>
          <label htmlFor={nameId}>{t.historyNameLabel}</label>
          <input
            id={nameId}
            type="text"
            value={draft}
            maxLength={MAX_SNAPSHOT_NAME_LENGTH}
            placeholder={t.historyNamePlaceholder}
            autoFocus
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="elysion-history__row">
            <button type="submit" className="elysion-history__primary" disabled={busy}>
              {t.historySaveConfirm}
            </button>
            <button type="button" onClick={() => setNaming(false)}>
              {t.historyCancel}
            </button>
          </div>
        </form>
      )}
      <div className="elysion-history__body">
        {problem && (
          <p className="elysion-history__problem" role="alert">
            {problem}
          </p>
        )}
        {items === null && <p role="status">{t.historyLoading}</p>}
        {items?.length === 0 && !problem && (
          <p className="elysion-history__empty">{t.historyEmpty}</p>
        )}
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`${headingId}-${group.key}`}>
            <h3 id={`${headingId}-${group.key}`} className="elysion-history__day">
              {group.label}
            </h3>
            <ul className="elysion-history__list">
              {group.items.map((snapshot) => {
                const title = titleOf(snapshot, t);
                const preview = previews[snapshot.id];
                return (
                  <li key={snapshot.id} className="elysion-history__entry">
                    <div className="elysion-history__preview">
                      {preview ? (
                        <img src={preview} alt={t.historyPreviewOf(title)} />
                      ) : (
                        <span aria-hidden="true">
                          {snapshot.id in previews ? t.historyNoPreview : ''}
                        </span>
                      )}
                    </div>
                    <div className="elysion-history__text">
                      {renaming === snapshot.id ? (
                        <form
                          className="elysion-history__row"
                          onSubmit={(event) => void rename(event, snapshot)}
                        >
                          <input
                            type="text"
                            value={renameDraft}
                            maxLength={MAX_SNAPSHOT_NAME_LENGTH}
                            aria-label={t.historyRenameOf(title)}
                            autoFocus
                            autoComplete="off"
                            onChange={(event) => setRenameDraft(event.target.value)}
                          />
                          <button type="submit" disabled={busy || !renameDraft.trim()}>
                            {t.historyRenameSave}
                          </button>
                          <button type="button" onClick={() => setRenaming(null)}>
                            {t.historyCancel}
                          </button>
                        </form>
                      ) : (
                        <strong className="elysion-history__title">{title}</strong>
                      )}
                      <span className="elysion-history__meta">
                        {[
                          time(snapshot.createdAt),
                          snapshot.author ? t.historyBy(snapshot.author) : null,
                          snapshot.elementCount === null
                            ? null
                            : t.historyElements(snapshot.elementCount),
                          formatSize(snapshot.sizeBytes),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {asking === snapshot.id ? (
                        <div className="elysion-history__row" role="group" aria-label={title}>
                          <span>{t.historyDeleteQuestion}</span>
                          <button
                            type="button"
                            className="elysion-history__danger"
                            autoFocus
                            disabled={busy}
                            onClick={() => void remove(snapshot)}
                          >
                            {t.historyDeleteConfirm}
                          </button>
                          <button type="button" onClick={() => setAsking(null)}>
                            {t.historyCancel}
                          </button>
                        </div>
                      ) : (
                        renaming !== snapshot.id && (
                          <div className="elysion-history__row">
                            {!readOnly && snapshot.kind === 'Manual' && (
                              <button
                                type="button"
                                aria-label={t.historyRenameOf(title)}
                                onClick={() => {
                                  setRenaming(snapshot.id);
                                  setRenameDraft(snapshot.name ?? '');
                                }}
                              >
                                {t.historyRename}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                aria-label={t.historyDeleteOf(title)}
                                onClick={() => setAsking(snapshot.id)}
                              >
                                {t.historyDelete}
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
