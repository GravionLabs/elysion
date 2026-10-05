import { describe, expect, it } from 'vitest';
import { toCollaborators } from './collaborators';
import { IDENTITY_COLORS } from './identity';

const user = (id: string, name = 'Ada', color = '#3b82f6') => ({ id, name, color });
const states = (entries: [number, unknown][]) => new Map(entries);

describe('toCollaborators', () => {
  it('maps another client to a collaborator with its name, color, pointer and selection', () => {
    const result = toCollaborators(
      states([
        [
          7,
          {
            user: user('u7', 'Ada', '#14b8a6'),
            pointer: { x: 10, y: 20, tool: 'pointer' },
            button: 'down',
            selectedElementIds: { a: true, b: true },
          },
        ],
      ]),
      1,
    );

    expect(result.size).toBe(1);
    expect(result.get('7' as never)).toEqual({
      id: 'u7',
      username: 'Ada',
      color: { background: '#14b8a6', stroke: '#14b8a6' },
      pointer: { x: 10, y: 20, tool: 'pointer' },
      button: 'down',
      selectedElementIds: { a: true, b: true },
    });
  });

  it('leaves the local client out: Excalidraw draws its own cursor', () => {
    const result = toCollaborators(
      states([
        [1, { user: user('me') }],
        [2, { user: user('you') }],
      ]),
      1,
    );

    expect([...result.keys()]).toEqual(['2']);
  });

  it('keeps a client that has not moved its pointer yet, without a pointer', () => {
    const [collaborator] = toCollaborators(states([[2, { user: user('u2') }]]), 1).values();

    expect(collaborator.pointer).toBeUndefined();
    expect(collaborator.button).toBe('up');
    expect(collaborator.selectedElementIds).toBeUndefined();
  });

  it.each([
    ['no state', null],
    ['an empty object', {}],
    ['a user without a name', { user: { id: 'x', color: '#3b82f6' } }],
    ['a user without an id', { user: { id: '', name: 'A', color: '#3b82f6' } }],
    ['a user whose color is not text', { user: { id: 'x', name: 'A', color: 7 } }],
    ['a string', 'hello'],
    ['a number', 42],
  ])('skips a client whose state is %s', (_label, state) => {
    expect(toCollaborators(states([[2, state]]), 1).size).toBe(0);
  });

  it('ignores a pointer that is not two finite numbers, but keeps the client', () => {
    const bad = [{ x: 'a', y: 1 }, { x: NaN, y: 1 }, { x: 1 }, 'here', null];
    for (const pointer of bad) {
      const [collaborator] = toCollaborators(
        states([[2, { user: user('u'), pointer }]]),
        1,
      ).values();
      expect(collaborator.pointer).toBeUndefined();
    }
  });

  it('knows the laser tool and treats any other tool as the pointer', () => {
    const tool = (value: unknown) =>
      [
        ...toCollaborators(
          states([[2, { user: user('u'), pointer: { x: 1, y: 1, tool: value } }]]),
          1,
        ).values(),
      ][0].pointer?.tool;

    expect(tool('laser')).toBe('laser');
    expect(tool('pointer')).toBe('pointer');
    expect(tool('<script>')).toBe('pointer');
  });

  it('only draws hex colors; anything else becomes the first palette color', () => {
    for (const color of ['red', 'url(javascript:1)', '#12', '#gggggg']) {
      const [collaborator] = toCollaborators(
        states([[2, { user: { id: 'u', name: 'A', color } }]]),
        1,
      ).values();
      expect(collaborator.color).toEqual({
        background: IDENTITY_COLORS[0],
        stroke: IDENTITY_COLORS[0],
      });
    }
  });

  it('cuts a long name short', () => {
    const [collaborator] = toCollaborators(
      states([[2, { user: user('u', 'x'.repeat(500)) }]]),
      1,
    ).values();

    expect(collaborator.username).toHaveLength(40);
  });

  it('keeps only the elements that are really selected', () => {
    const [collaborator] = toCollaborators(
      states([[2, { user: user('u'), selectedElementIds: { a: true, b: false, c: 'yes' } }]]),
      1,
    ).values();

    expect(collaborator.selectedElementIds).toEqual({ a: true });
  });

  it('is empty for an empty board', () => {
    expect(toCollaborators(states([]), 1).size).toBe(0);
  });
});
