// Fills a running Elysion stack with data that an upgrade has to carry along, and checks that it is still there afterwards
// (the upgrade job of the container workflow, #694; also for a load test and for trying an upgrade by hand):
//
//   node scripts/fill-stack.mjs fill   [manifest.json]   makes rooms, boards with content, a template and a vote
//   node scripts/fill-stack.mjs verify [manifest.json]   reads it all back and fails when something is missing
//
// What it makes (as the demo user dev1, over the same API and WebSocket the app uses): two rooms, six boards (the first
// five in a room, the last in none) with 10, 20, ... 60 elements each pushed through a Yjs client, a template, and on the
// first board a dot voting with two votes. The manifest records the ids and counts; `verify` opens each board's document
// through the WebSocket like a browser does and counts the elements it gets back.
//
// Options: APP (default http://localhost), KEYCLOAK (default http://localhost:8081), FILL_USER (default dev1; the password is
// the username, as in the demo realm).
import { readFileSync, writeFileSync } from 'node:fs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import WebSocket from 'ws';
import * as Y from 'yjs';

const APP = process.env.APP ?? 'http://localhost';
const KEYCLOAK = process.env.KEYCLOAK ?? 'http://localhost:8081';
const USER = process.env.FILL_USER ?? 'dev1';
const MESSAGE_SYNC = 0; // apps/realtime/src/yjs/protocol.ts

const [mode, manifestPath = 'fill-manifest.json'] = process.argv.slice(2);
if (mode !== 'fill' && mode !== 'verify') {
  console.error('usage: node scripts/fill-stack.mjs <fill|verify> [manifest.json]');
  process.exit(2);
}

function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}
const ok = (message) => console.log(`ok  ${message}`);

async function login(user) {
  const response = await fetch(`${KEYCLOAK}/realms/elysion/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'elysion-frontend',
      username: user,
      password: user,
    }),
  });
  const body = await response.json();
  if (!body.access_token) fail(`${user} cannot log in (${response.status})`);
  return body.access_token;
}

let token = '';
async function api(method, path, body, expected = [200, 201, 204]) {
  const response = await fetch(`${APP}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expected.includes(response.status)) {
    fail(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Opens a board's document like the canvas does: a WS token, then the sync protocol; resolves once the state arrived. */
async function openDocument(boardId) {
  const { token: wsToken } = await api('POST', '/realtime/token', { boardId });
  const url = new URL(`${APP.replace(/^http/, 'ws')}/yjs`);
  url.searchParams.set('board', boardId);
  url.searchParams.set('token', wsToken);
  const doc = new Y.Doc();
  const socket = new WebSocket(url);
  const send = (write) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    if (socket.readyState === WebSocket.OPEN) socket.send(encoding.toUint8Array(encoder));
  };
  let synced = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the document of ${boardId} did not sync`)),
      20000,
    );
    socket.on('error', reject);
    socket.on('open', () => send((encoder) => syncProtocol.writeSyncStep1(encoder, doc)));
    socket.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const type = syncProtocol.readSyncMessage(decoder, encoder, doc, 'server');
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
      if (type === syncProtocol.messageYjsSyncStep2 && !synced) {
        synced = true;
        clearTimeout(timer);
        resolve();
      }
    });
  });
  doc.on('update', (update, origin) => {
    if (origin !== 'server') send((encoder) => syncProtocol.writeUpdate(encoder, update));
  });
  return {
    doc,
    /** Waits a little so the realtime service has the changes (it saves two seconds after the last one), then closes. */
    async close() {
      await new Promise((resolve) => setTimeout(resolve, 500));
      socket.close();
      await new Promise((resolve) => socket.once('close', resolve));
    },
  };
}

/** An Excalidraw rectangle with every field the canvas expects, so that the board also opens in a browser. */
function rectangle(index) {
  const id = `fill-${index}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    type: 'rectangle',
    x: (index % 10) * 120,
    y: Math.floor(index / 10) * 90,
    width: 100,
    height: 70,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: '#ffec99',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${String(index).padStart(4, '0')}`,
    roundness: { type: 3 },
    seed: 1000 + index,
    version: 1,
    versionNonce: 2000 + index,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function startVoting(doc, user, name) {
  const sessionId = crypto.randomUUID();
  doc.transact(() => {
    const root = doc.getMap('session');
    const voting = new Y.Map();
    root.set('voting', voting);
    const sessions = new Y.Map();
    voting.set('sessions', sessions);
    const session = new Y.Map();
    sessions.set(sessionId, session);
    session.set('name', name);
    session.set('votesPerPerson', 3);
    session.set('status', 'open');
    session.set('startedBy', { id: user.id, name: user.name });
    session.set('startedAt', Date.now());
    session.set('closedAt', null);
    const votes = new Y.Map();
    session.set('votes', votes);
    voting.set('openSessionId', sessionId);
  });
  return sessionId;
}

function castVotes(doc, sessionId, userId, elementIds) {
  const session = doc.getMap('session').get('voting').get('sessions').get(sessionId);
  const list = new Y.Array();
  session.get('votes').set(userId, list);
  list.push(elementIds);
}

async function fill() {
  token = await login(USER);
  const me = { id: JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub, name: USER };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const rooms = [];
  for (const name of ['Fill room A', 'Fill room B']) {
    rooms.push(await api('POST', '/rooms', { name: `${name} ${stamp}` }));
  }
  ok(`made ${rooms.length} rooms`);

  const boards = [];
  for (let n = 1; n <= 6; n++) {
    const board = await api('POST', '/boards', { name: `Fill board ${n} ${stamp}` });
    const room = n <= 3 ? rooms[0] : n <= 5 ? rooms[1] : null;
    if (room) await api('PUT', `/boards/${board.id}/room`, { roomId: room.id });
    const { doc, close } = await openDocument(board.id);
    const elements = doc.getMap('elements');
    const ids = [];
    doc.transact(() => {
      for (let i = 0; i < n * 10; i++) {
        const element = rectangle(i);
        elements.set(element.id, element);
        ids.push(element.id);
      }
    });
    let vote = null;
    if (n === 1) {
      const sessionId = startVoting(doc, me, 'Fill voting');
      castVotes(doc, sessionId, me.id, ids.slice(0, 2));
      vote = { sessionId, name: 'Fill voting', votes: 2 };
    }
    await close();
    boards.push({
      id: board.id,
      name: board.name,
      roomId: room?.id ?? null,
      elements: ids.length,
      ids,
      vote,
    });
  }
  ok(
    `made ${boards.length} boards with content (${boards.reduce((sum, b) => sum + b.elements, 0)} elements)`,
  );

  const scene = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'fill-stack',
    elements: Array.from({ length: 5 }, (_, i) => rectangle(i)),
    appState: {},
    files: {},
  });
  const template = await api('POST', '/templates', {
    name: `Fill template ${stamp}`,
    description: 'made by fill-stack',
    scene,
  });
  ok(`made the template "${template.name}"`);

  writeFileSync(
    manifestPath,
    JSON.stringify(
      { user: USER, rooms, boards, template: { id: template.id, name: template.name } },
      null,
      2,
    ),
  );
  ok(`wrote ${manifestPath}`);
}

async function verify() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  token = await login(manifest.user);

  const rooms = await api('GET', '/rooms');
  for (const room of manifest.rooms) {
    if (!rooms.some((r) => r.id === room.id && r.name === room.name))
      fail(`the room "${room.name}" is gone`);
  }
  ok(`the ${manifest.rooms.length} rooms are there`);

  const listed = await api('GET', '/boards');
  for (const board of manifest.boards) {
    const found = listed.find((b) => b.id === board.id);
    if (!found) fail(`the board "${board.name}" is gone`);
    if (found.name !== board.name)
      fail(`the board ${board.id} is called "${found.name}", not "${board.name}"`);
    if ((found.roomId ?? null) !== board.roomId)
      fail(`the board "${board.name}" is in another room`);
  }
  ok(`the ${manifest.boards.length} boards are listed, each in its room`);

  for (const board of manifest.boards) {
    const { doc, close } = await openDocument(board.id);
    const elements = doc.getMap('elements');
    const missing = board.ids.filter((id) => !elements.has(id));
    if (missing.length > 0)
      fail(`"${board.name}" lost ${missing.length} of ${board.elements} elements`);
    if (board.vote) {
      const voting = doc.getMap('session').get('voting');
      const session = voting?.get('sessions')?.get(board.vote.sessionId);
      if (!session || session.get('name') !== board.vote.name)
        fail(`the voting of "${board.name}" is gone`);
      const placed = Object.values(session.get('votes').toJSON()).flat().length;
      if (placed !== board.vote.votes)
        fail(`the voting of "${board.name}" has ${placed} votes, not ${board.vote.votes}`);
    }
    await close();
  }
  ok('every document opens with all its elements, and the voting with its votes');

  const templates = await api('GET', '/templates');
  if (!templates.some((t) => t.id === manifest.template.id && t.name === manifest.template.name)) {
    fail(`the template "${manifest.template.name}" is gone`);
  }
  if (!templates.some((t) => t.name === 'Retrospective'))
    fail('the built-in templates are missing');
  ok('the template and the built-in ones are there');
  console.log('Everything the stack was filled with is still there.');
}

await (mode === 'fill' ? fill() : verify());
