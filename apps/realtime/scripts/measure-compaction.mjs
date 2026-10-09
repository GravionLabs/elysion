// Measures what compaction of a board document would win, for ADR 0027's question (#697). Run from the repo root:
//   pnpm --filter @elysion/realtime exec node scripts/measure-compaction.mjs
// It builds boards like the ones of ADR 0011 (sticky notes with their text, arrows), moves elements with several
// clients writing in turn (as a drag does: one write per pointer move), and then re-encodes the state three ways.
import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';

const KB = 1024;
const fmt = (bytes) =>
  bytes >= KB * KB ? `${(bytes / KB / KB).toFixed(2)} MB` : `${(bytes / KB).toFixed(1)} KB`;
let seed = 42;
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

/** An element of about the size of a real one (ADR 0011: 551 bytes of JSON on average). */
function element(index) {
  const id = `el${index.toString(36).padStart(6, '0')}${Math.floor(random() * 1e9).toString(36)}`;
  return {
    id,
    type: index % 3 === 0 ? 'text' : 'rectangle',
    x: Math.round(random() * 5000),
    y: Math.round(random() * 5000),
    width: 120 + Math.round(random() * 80),
    height: 80 + Math.round(random() * 40),
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: '#ffec99',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${index.toString(36)}`,
    roundness: { type: 3 },
    seed: Math.floor(random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: 1760000000000,
    link: null,
    locked: false,
    text: index % 3 === 0 ? 'Pairing made the release smooth' : undefined,
  };
}

function build({ elements, clients, writes }) {
  const docs = Array.from({ length: clients }, () => new Y.Doc());
  // every client's changes reach all the others at once, as the relay does
  for (const doc of docs) {
    doc.on('update', (update, origin) => {
      if (origin === 'remote') return;
      for (const other of docs) if (other !== doc) Y.applyUpdate(other, update, 'remote');
    });
  }
  const ids = [];
  for (let i = 0; i < elements; i++) {
    const el = element(i);
    ids.push(el.id);
    docs[0].getMap('elements').set(el.id, el);
  }
  let log = 0;
  docs[0].on('update', (u) => (log += u.length));
  for (let w = 0; w < writes; w++) {
    const doc = docs[w % clients];
    const map = doc.getMap('elements');
    const id = ids[Math.floor(random() * ids.length)];
    const current = map.get(id);
    map.set(id, {
      ...current,
      x: current.x + 1,
      y: current.y + 1,
      version: current.version + 1,
      versionNonce: Math.floor(random() * 2 ** 31),
    });
  }
  return docs[0];
}

function time(fn) {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

const scenarios = [
  { name: 'Typical workshop, 20 moves each', elements: 700, clients: 1, writes: 14_000 },
  {
    name: 'Typical workshop, 20 minutes of dragging, 5 people',
    elements: 700,
    clients: 5,
    writes: 72_000,
  },
  { name: 'Large board, 100 moves each, 5 people', elements: 3_500, clients: 5, writes: 350_000 },
];

console.log(
  '| Scenario | Elements | Writes | State | gzipped | A: re-encode in a fresh doc | B: rebuilt from the elements | Rebuild time |',
);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const scenario of scenarios) {
  const doc = build(scenario);
  const state = Y.encodeStateAsUpdate(doc);
  // A: what a save could do without losing history: apply the state to a fresh document and encode it again.
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, state);
  const reencoded = Y.encodeStateAsUpdate(fresh);
  // B: a new document from the live elements only (new client id, new clocks).
  const [rebuilt, ms] = time(() => {
    const next = new Y.Doc();
    const map = next.getMap('elements');
    next.transact(() => {
      for (const [id, value] of doc.getMap('elements').entries())
        map.set(id, structuredClone(value));
    });
    return Y.encodeStateAsUpdate(next);
  });
  console.log(
    `| ${scenario.name} | ${scenario.elements} | ${scenario.writes} | ${fmt(state.length)} | ${fmt(gzipSync(state).length)} | ${fmt(reencoded.length)} | ${fmt(rebuilt.length)} (gz ${fmt(gzipSync(rebuilt).length)}) | ${ms.toFixed(0)} ms |`,
  );
}
