import { describe, expect, it } from 'vitest';
import { de, en } from '../i18n';
import { addItem, nextItem, startItem } from './agenda';
import { buildAgendaPage } from './agenda-export';

const T0 = 1_000_000;
const MIN = 60_000;

describe('the agenda page of a PDF (#849)', () => {
  const plan = addItem(addItem(addItem([], 'a', 'Intro', 5), 'b', 'Ideas', 20), 'c', 'Wrap-up', 10);

  it('lists every item with its planned and spent minutes and the totals', () => {
    const run = nextItem(startItem(plan, 'a', T0), T0 + 4 * MIN).items; // Intro done after 4, Ideas running

    expect(buildAgendaPage(run, en, T0 + 10 * MIN)).toEqual({
      title: 'Agenda',
      lines: [
        { text: '1. Intro (Done)', bold: true, after: 0 },
        { text: 'Planned 5 min, spent 4 min', indent: 12, after: 8 },
        { text: '2. Ideas (Now)', bold: true, after: 0 },
        { text: 'Planned 20 min, spent 6 min', indent: 12, after: 8 },
        { text: '3. Wrap-up', bold: true, after: 0 },
        { text: 'Planned 10 min, spent 0 min', indent: 12, after: 8 },
        { text: 'Total: planned 35 min, spent 10 min', bold: true, after: 0 },
      ],
    });
  });

  it('speaks the locale', () => {
    expect(buildAgendaPage(plan, de, T0)?.lines.at(-1)?.text).toBe(
      'Gesamt: geplant 35 Min., gebraucht 0 Min.',
    );
  });

  it('is null without an agenda', () => {
    expect(buildAgendaPage([], en, T0)).toBeNull();
  });
});
