import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_STYLE,
  createConnector,
  elbowRoute,
  facingSides,
  isConnectable,
  sidePoint,
  type ScenePoint,
  type Side,
} from './connector';
import { createStickyNote, STICKY_COLORS } from './sticky-note';

const box = (x: number, y: number, width = 100, height = 60): ExcalidrawElement =>
  convertToExcalidrawElements([{ type: 'rectangle', x, y, width, height }])[0];

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const OUT: Record<Side, ScenePoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** The attributes of the arrow that the tests look at (the element type is a union, so read it loosely). */
const arrowOf = (element: ExcalidrawElement) =>
  element as unknown as {
    type: string;
    elbowed: boolean;
    endArrowhead: string | null;
    startArrowhead: string | null;
    startBinding: { elementId: string; fixedPoint: [number, number] } | null;
    endBinding: { elementId: string; fixedPoint: [number, number] } | null;
    points: [number, number][];
    x: number;
    y: number;
  };

describe('createConnector', () => {
  it('makes an elbow arrow bound to both shapes, with the arrowhead at the end only', () => {
    const a = box(0, 0);
    const b = box(300, 0);

    const { arrow } = createConnector([a, b], a.id, b.id);

    const connector = arrowOf(arrow);
    expect(connector.type).toBe('arrow');
    expect(connector.elbowed).toBe(true);
    expect(connector.startArrowhead).toBeNull();
    expect(connector.endArrowhead).toBe('arrow');
    expect(connector.startBinding?.elementId).toBe(a.id);
    expect(connector.endBinding?.elementId).toBe(b.id);
    expect(CONNECTOR_STYLE.elbowed).toBe(true);
  });

  it('leaves the shapes with their ids and lists the connector in both', () => {
    const a = box(0, 0);
    const b = box(300, 0);

    const { arrow, updated } = createConnector([a, b], a.id, b.id);

    expect(updated.map((shape) => shape.id)).toEqual([a.id, b.id]);
    for (const shape of updated) {
      expect(shape.boundElements).toContainEqual({ id: arrow.id, type: 'arrow' });
    }
  });

  it('keeps the text that is already bound inside a sticky note', () => {
    const [card, text] = createStickyNote(STICKY_COLORS[0], { x: 0, y: 0 });
    const other = box(400, 0);

    const { updated } = createConnector([card, text, other], card.id, other.id);

    const bound = updated[0].boundElements ?? [];
    expect(bound.filter((entry) => entry.type === 'text')).toEqual([{ id: text.id, type: 'text' }]);
    expect(bound.filter((entry) => entry.type === 'arrow')).toHaveLength(1);
  });

  it.each([
    ['right of the source', { x: 300, y: 0 }, [1, 0.5], [0, 0.5]],
    ['left of the source', { x: -300, y: 0 }, [0, 0.5], [1, 0.5]],
    ['below the source', { x: 0, y: 300 }, [0.5, 1], [0.5, 0]],
    ['above the source', { x: 0, y: -300 }, [0.5, 0], [0.5, 1]],
  ] as const)(
    'attaches to the sides that face each other when the target is %s',
    (_name, at, startAt, endAt) => {
      const a = box(0, 0);
      const b = box(at.x, at.y);

      const connector = arrowOf(createConnector([a, b], a.id, b.id).arrow);

      const near = (actual: number[] | undefined, expected: readonly number[]) =>
        expected.forEach((value, i) => expect(actual?.[i]).toBeCloseTo(value, 1));
      near(connector.startBinding?.fixedPoint, startAt);
      near(connector.endBinding?.fixedPoint, endAt);
    },
  );

  it('attaches to the sides it is told to', () => {
    const a = box(0, 0);
    const b = box(300, 200);

    const connector = arrowOf(
      createConnector([a, b], a.id, b.id, { sourceSide: 'bottom', targetSide: 'left' }).arrow,
    );

    expect(connector.startBinding?.fixedPoint[0]).toBeCloseTo(0.5, 1);
    expect(connector.startBinding?.fixedPoint[1]).toBeCloseTo(1, 1);
    expect(connector.endBinding?.fixedPoint[0]).toBeCloseTo(0, 1);
    expect(connector.endBinding?.fixedPoint[1]).toBeCloseTo(0.5, 1);
  });

  it('refuses the same element twice, an element that is not there, and what is not a shape', () => {
    const a = box(0, 0);
    const b = box(300, 0);
    const [line] = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [50, 50],
        ],
      },
    ] as never);

    expect(() => createConnector([a, b], a.id, a.id)).toThrow('two different elements');
    expect(() => createConnector([a], a.id, b.id)).toThrow('on the board');
    expect(() => createConnector([a, b, line], a.id, line.id)).toThrow('only join shapes');
  });
});

describe('isConnectable', () => {
  it('is true for shapes, images, frames and free text, false for arrows and text inside a shape', () => {
    const [card, text] = createStickyNote(STICKY_COLORS[0], { x: 0, y: 0 });
    const [free] = convertToExcalidrawElements([{ type: 'text', x: 0, y: 0, text: 'Hi' }]);
    const [arrow] = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [10, 10],
        ],
      },
    ] as never);

    expect(isConnectable(box(0, 0))).toBe(true);
    expect(isConnectable(card)).toBe(true);
    expect(isConnectable(free)).toBe(true);
    expect(isConnectable(text)).toBe(false);
    expect(isConnectable(arrow)).toBe(false);
    expect(isConnectable({ ...box(0, 0), isDeleted: true })).toBe(false);
  });
});

describe('sidePoint', () => {
  it('is the middle of the side of an upright shape', () => {
    const a = box(10, 20, 100, 60);

    expect(sidePoint(a, 'top')).toEqual({ x: 60, y: 20 });
    expect(sidePoint(a, 'right')).toEqual({ x: 110, y: 50 });
    expect(sidePoint(a, 'bottom')).toEqual({ x: 60, y: 80 });
    expect(sidePoint(a, 'left')).toEqual({ x: 10, y: 50 });
  });

  it('turns with a rotated shape', () => {
    const a = { ...box(0, 0, 100, 60), angle: Math.PI / 2 } as ExcalidrawElement;

    const right = sidePoint(a, 'right');

    // Rotated by 90 degrees around its center (50, 30), the right side is where the bottom side was.
    expect(right.x).toBeCloseTo(50, 5);
    expect(right.y).toBeCloseTo(80, 5);
  });
});

describe('facingSides', () => {
  it('lets the larger distance between the centers decide', () => {
    const a = box(0, 0);

    expect(facingSides(a, box(400, 100))).toEqual({ sourceSide: 'right', targetSide: 'left' });
    expect(facingSides(a, box(-400, 100))).toEqual({ sourceSide: 'left', targetSide: 'right' });
    expect(facingSides(a, box(100, 400))).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
    expect(facingSides(a, box(100, -400))).toEqual({ sourceSide: 'top', targetSide: 'bottom' });
  });
});

describe('elbowRoute', () => {
  it('is an L when one side is horizontal, the other vertical and the target lies that way', () => {
    const route = elbowRoute({ x: 0, y: 0 }, OUT.right, { x: 200, y: 100 }, OUT.top);

    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });

  it('is a Z through the middle for sides that face each other', () => {
    const route = elbowRoute({ x: 0, y: 0 }, OUT.right, { x: 200, y: 100 }, OUT.left);

    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('is a straight line when the two sides are in line', () => {
    const route = elbowRoute({ x: 0, y: 0 }, OUT.right, { x: 200, y: 0 }, OUT.left);

    expect(route).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it('leaves and enters straight when it has to turn back (right side to right side)', () => {
    const route = elbowRoute({ x: 0, y: 0 }, OUT.right, { x: 0, y: 200 }, OUT.right);

    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route[1].y).toBe(0); // out of the source along its side's direction
    expect(route[1].x).toBeGreaterThan(0);
    expect(route.at(-1)).toEqual({ x: 0, y: 200 });
    expect(route.at(-2)?.y).toBe(200); // into the target along its side's direction
  });

  it('only ever makes right angles, from any side to any side, wherever the target lies', () => {
    const targets: ScenePoint[] = [
      { x: 300, y: 0 },
      { x: -300, y: 0 },
      { x: 0, y: 300 },
      { x: 0, y: -300 },
      { x: 300, y: 200 },
      { x: -300, y: 200 },
      { x: 300, y: -200 },
      { x: -300, y: -200 },
      { x: 5, y: 5 },
    ];
    for (const exit of SIDES) {
      for (const entry of SIDES) {
        for (const to of targets) {
          const route = elbowRoute({ x: 0, y: 0 }, OUT[exit], to, OUT[entry]);
          const label = `${exit} -> ${entry} at ${to.x},${to.y}`;
          expect(route[0], label).toEqual({ x: 0, y: 0 });
          expect(route.at(-1), label).toEqual(to);
          route.slice(1).forEach((point, i) => {
            const before = route[i];
            expect(point.x === before.x || point.y === before.y, label).toBe(true);
          });
        }
      }
    }
  });
});
