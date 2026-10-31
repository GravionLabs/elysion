import type { Messages } from '../i18n';
import type { PdfTextPage } from '../pdf';
import { spentOn, totalMinutes, type AgendaItem } from './agenda';

/** Whole minutes of a time in milliseconds. */
const minutes = (ms: number) => Math.round(ms / 60_000);

/**
 * The agenda as the first page of a PDF export (#849, off by default): per item its number, title and state, then the planned
 * and the spent minutes, and the totals at the end. `null` for a board without an agenda.
 */
export function buildAgendaPage(
  items: readonly AgendaItem[],
  t: Messages,
  now: number,
): PdfTextPage | null {
  if (items.length === 0) return null;
  const spent = items.reduce((sum, item) => sum + spentOn(item, now), 0);
  return {
    title: t.agendaPdfTitle,
    lines: [
      ...items.flatMap((item, index) => {
        const state =
          item.state === 'current'
            ? ` (${t.agendaStateCurrent})`
            : item.state === 'done'
              ? ` (${t.agendaStateDone})`
              : '';
        return [
          { text: `${index + 1}. ${item.title}${state}`, bold: true, after: 0 },
          {
            text: t.agendaPdfTimes(item.durationMin, minutes(spentOn(item, now))),
            indent: 12,
            after: 8,
          },
        ];
      }),
      { text: t.agendaPdfTotal(totalMinutes(items), minutes(spent)), bold: true, after: 0 },
    ],
  };
}
