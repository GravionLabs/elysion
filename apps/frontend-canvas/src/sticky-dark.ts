import { STICKY_COLORS, borderColor, darkThemeColor, paperColor, shade } from './sticky-note';

/**
 * Sticky notes in the dark theme (#737).
 *
 * Excalidraw darkens the whole canvas with `invert(93%) hue-rotate(180deg)`, which turns a light pastel into a muddy brown. The
 * design wants "yellow" to read as the yellow of the dark palette (`--c-node-*` in the dark block of packages/design-tokens). The
 * filter cannot be switched off for one kind of element, so the notes are handed to it in a color that comes out right: for each of
 * the 16 stored colors of the palette (paper and border of the 8 notes) there is a *scene color* whose filtered result is the wanted
 * dark color.
 *
 * The mapping is for the scene only. The document keeps the stored (light) colors, which everybody shares whatever theme they use;
 * the binding maps at the boundary (`recolor`) and never writes a scene color. A color that is not in the table is never touched.
 */

/** The dark-theme values of `--c-node-*`, by the name of the note color (packages/design-tokens/tokens.css, dark block). */
export const DARK_NODE_COLORS: Readonly<Record<(typeof STICKY_COLORS)[number]['name'], string>> = {
  Yellow: '#facc15',
  Orange: '#fb923c',
  Red: '#f87171',
  Pink: '#f472b6',
  Purple: '#a78bfa',
  Blue: '#60a5fa',
  Teal: '#2dd4bf',
  Green: '#4ade80',
};

/** How much black goes into the dark paper: the text of a note is light on the dark canvas, so the paper stays a deep shade. */
const DARK_PAPER_SHADE = 0.62;

// hue-rotate(180deg) as the matrix the browser uses (the same numbers as `darkThemeColor`).
const HUE: readonly (readonly number[])[] = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

function inverse(m: readonly (readonly number[])[]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

const HUE_INVERSE = inverse(HUE);

const toHex = (channels: readonly number[]): string =>
  `#${channels
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/**
 * The color that the dark theme's filter turns into `wanted`: the filter run backwards (an inverse of the matrix, then of the
 * 93 % inversion), clamped to what a color can be. A `wanted` that no color reaches comes out as the nearest one, which
 * `darkThemeColor` of the result tells.
 */
export function preImage(wanted: string): string {
  const target = [1, 3, 5].map((offset) => parseInt(wanted.slice(offset, offset + 2), 16));
  const inverted = HUE_INVERSE.map(
    (row) => row[0] * target[0] + row[1] * target[1] + row[2] * target[2],
  );
  // invert(93%): v' = 0.07 v + 0.93 (255 - v) = 237.15 - 0.86 v
  return toHex(inverted.map((value) => (237.15 - value) / 0.86));
}

const channelsOf = (hex: string): number[] =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

/** Whether the dark theme's filter can make `wanted` out of some color (a very saturated bright color cannot: a channel would have to be below 0). */
function isReachable(wanted: string): boolean {
  const back = channelsOf(darkThemeColor(preImage(wanted)));
  return channelsOf(wanted).every((value, index) => Math.abs(value - back[index]) <= 3);
}

/**
 * The color itself when the filter can make it, else the least darker shade of it that it can: the hue is kept (a bright yellow
 * comes out as a yellow, not as an orange-pink that a clamped channel would give).
 */
export function reachableShade(wanted: string): string {
  for (let amount = 0; amount < 0.7; amount += 0.02) {
    const candidate = shade(wanted, amount);
    if (isReachable(candidate)) return candidate;
  }
  return shade(wanted, 0.7);
}

interface Pair {
  stored: string;
  scene: string;
}

function buildPairs(): Pair[] {
  const pairs: Pair[] = [];
  for (const color of STICKY_COLORS) {
    const token = DARK_NODE_COLORS[color.name];
    pairs.push({ stored: paperColor(color), scene: preImage(shade(token, DARK_PAPER_SHADE)) });
    pairs.push({ stored: borderColor(color), scene: preImage(reachableShade(token)) });
  }
  return pairs;
}

/** The 16 pairs of a stored color and the color the scene carries in the dark theme. */
export const STICKY_COLOR_PAIRS: readonly Pair[] = buildPairs();

const TO_SCENE = new Map(STICKY_COLOR_PAIRS.map((pair) => [pair.stored, pair.scene]));
const TO_STORED = new Map(STICKY_COLOR_PAIRS.map((pair) => [pair.scene, pair.stored]));

/** The color the scene carries for a stored color in the dark theme: the stored one itself when it is not a note color. */
export function storedToScene(color: string): string {
  return TO_SCENE.get(color.toLowerCase()) ?? color;
}

/** The stored color of a color the scene carries: the color itself when it is not one of the dark scene colors of the notes. */
export function sceneToStored(color: string): string {
  return TO_STORED.get(color.toLowerCase()) ?? color;
}

/** What a stored color looks like on the dark canvas: the filter applied to what the scene carries. */
export function seenInDark(stored: string): string {
  return darkThemeColor(storedToScene(stored));
}

/**
 * The color as it is seen on the canvas in a theme: what the toolbar's note icons show, so that the menu and the note that is
 * drawn look the same. The stored color in the light theme; in the dark one the note colors as they are drawn there.
 */
export function seenColor(hex: string, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? seenInDark(hex) : hex;
}

interface Colored {
  backgroundColor?: string;
  strokeColor?: string;
}

/**
 * Copies of the elements in which the colors went through `convert`; an element it changes nothing on is returned as it is (the
 * same object), and a changed one is a copy with the same version and nonce, so nothing sees it as an edit.
 */
export function recolor<T extends Colored>(
  elements: readonly T[],
  convert: (color: string) => string,
): T[] {
  return elements.map((element) => {
    const background =
      element.backgroundColor === undefined ? undefined : convert(element.backgroundColor);
    const stroke = element.strokeColor === undefined ? undefined : convert(element.strokeColor);
    if (background === element.backgroundColor && stroke === element.strokeColor) return element;
    return {
      ...element,
      ...(background === undefined ? {} : { backgroundColor: background }),
      ...(stroke === undefined ? {} : { strokeColor: stroke }),
    };
  });
}

/** Whether `recolor` with `convert` would change any of the elements (the cheap question: nothing is copied). */
export function wouldRecolor(
  elements: readonly Colored[],
  convert: (color: string) => string,
): boolean {
  return elements.some(
    (element) =>
      (element.backgroundColor !== undefined &&
        convert(element.backgroundColor) !== element.backgroundColor) ||
      (element.strokeColor !== undefined && convert(element.strokeColor) !== element.strokeColor),
  );
}
