import * as Y from 'yjs';
import { WebSocket as NodeWebSocketClient } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestYjsServer, waitUntil, type TestYjsServer } from './test-yjs-server.js';
import { YjsWebsocketClient } from './YjsWebsocketClient.js';

const WebSocketImpl = NodeWebSocketClient as unknown as typeof WebSocket;

describe('YjsWebsocketClient', () => {
  let server: TestYjsServer;

  beforeEach(async () => {
    server = await startTestYjsServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('converges two clients after either applies an update', async () => {
    const clientA = new YjsWebsocketClient(server.url, new Y.Doc(), { WebSocketImpl });
    const clientB = new YjsWebsocketClient(server.url, new Y.Doc(), { WebSocketImpl });

    clientA.doc.getMap('board').set('hello', 'world');
    await waitUntil(() => clientB.doc.getMap('board').get('hello') === 'world');
    expect(clientB.doc.getMap('board').get('hello')).toBe('world');

    clientB.doc.getMap('board').set('from', 'b');
    await waitUntil(() => clientA.doc.getMap('board').get('from') === 'b');
    expect(clientA.doc.getMap('board').get('from')).toBe('b');

    clientA.destroy();
    clientB.destroy();
  });

  it('reports connection status transitions', async () => {
    const statuses: string[] = [];
    const client = new YjsWebsocketClient(server.url, new Y.Doc(), {
      onStatusChange: (status) => statuses.push(status),
      WebSocketImpl,
    });

    await waitUntil(() => statuses.includes('connected'));
    expect(statuses).toEqual(['connecting', 'connected']);

    client.destroy();
  });

  describe('failures', () => {
    const options = { WebSocketImpl, reconnectDelayMs: 30 };

    it('reports a connection that cannot be opened once, not on every retry', async () => {
      const unused = await startTestYjsServer();
      const url = unused.url;
      await unused.close(); // nobody listens on this port now
      const errors: Error[] = [];
      const client = new YjsWebsocketClient(url, new Y.Doc(), {
        ...options,
        onError: (error) => errors.push(error),
      });

      await waitUntil(() => errors.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 200)); // several retries later
      client.destroy();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('connection');
    });

    it('reports a failure again after the connection was up in between', async () => {
      const errors: Error[] = [];
      const statuses: string[] = [];
      const client = new YjsWebsocketClient(`${server.url}?board=failing`, new Y.Doc(), {
        ...options,
        onStatusChange: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
      });
      await waitUntil(() => statuses.includes('connected'));

      server.closeConnections(1011);
      await waitUntil(() => errors.length === 1);
      await waitUntil(() => statuses.filter((status) => status === 'connected').length === 2);
      server.closeConnections(1011);
      await waitUntil(() => errors.length === 2);

      client.destroy();
    });

    it('says the server could not serve the board when it closes with 1011', async () => {
      const errors: Error[] = [];
      const client = new YjsWebsocketClient(`${server.url}?board=unloadable`, new Y.Doc(), {
        ...options,
        onError: (error) => errors.push(error),
      });
      await waitUntil(() => client.awareness.getStates().size > 0);

      server.closeConnections(1011);
      await waitUntil(() => errors.length > 0);

      expect(errors[0].message).toContain('could not serve the board');
      client.destroy();
    });

    it('does not call it a failure when the connection just drops or the caller leaves', async () => {
      const errors: Error[] = [];
      const statuses: string[] = [];
      const client = new YjsWebsocketClient(`${server.url}?board=dropping`, new Y.Doc(), {
        ...options,
        onStatusChange: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
      });
      await waitUntil(() => statuses.includes('connected'));

      server.dropConnections();
      await waitUntil(() => statuses.includes('disconnected'));
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errors).toEqual([]);
    });
  });

  describe('awareness', () => {
    const options = { WebSocketImpl, reconnectDelayMs: 50 };
    const board = (name: string) => `${server.url}?board=${name}`;
    const stateOf = (client: YjsWebsocketClient, of: YjsWebsocketClient) =>
      client.awareness.getStates().get(of.doc.clientID);

    it('shows one client the state another one sets', async () => {
      const a = new YjsWebsocketClient(board('one'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('one'), new Y.Doc(), options);
      await waitUntil(() => a.awareness.getStates().size > 0 && b.awareness.getStates().size > 0);

      a.awareness.setLocalState({ user: { name: 'Ada' }, pointer: { x: 1, y: 2 } });

      await waitUntil(() => stateOf(b, a) !== undefined);
      expect(stateOf(b, a)).toEqual({ user: { name: 'Ada' }, pointer: { x: 1, y: 2 } });
      a.destroy();
      b.destroy();
    });

    it('sends changes of a state without the caller sending anything by hand', async () => {
      const a = new YjsWebsocketClient(board('two'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('two'), new Y.Doc(), options);
      a.awareness.setLocalState({ pointer: { x: 1, y: 1 } });
      await waitUntil(() => stateOf(b, a) !== undefined);

      a.awareness.setLocalStateField('pointer', { x: 50, y: 60 });

      await waitUntil(() => (stateOf(b, a) as { pointer: { x: number } }).pointer.x === 50);
      a.destroy();
      b.destroy();
    });

    it('applies the snapshot of who is already there when joining, without waiting for a move', async () => {
      const a = new YjsWebsocketClient(board('three'), new Y.Doc(), options);
      a.awareness.setLocalState({ user: { name: 'Grace' } });
      await new Promise((resolve) => setTimeout(resolve, 150)); // the server has it

      const late = new YjsWebsocketClient(board('three'), new Y.Doc(), options);

      await waitUntil(() => stateOf(late, a) !== undefined);
      expect(stateOf(late, a)).toEqual({ user: { name: 'Grace' } });
      a.destroy();
      late.destroy();
    });

    it('keeps boards apart', async () => {
      const a = new YjsWebsocketClient(board('left'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('right'), new Y.Doc(), options);
      a.awareness.setLocalState({ user: { name: 'Ada' } });
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(stateOf(b, a)).toBeUndefined();
      a.destroy();
      b.destroy();
    });

    it('does not echo what it applied back to the server', async () => {
      const a = new YjsWebsocketClient(board('quiet'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('quiet'), new Y.Doc(), options);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const before = server.awarenessMessagesReceived();

      a.awareness.setLocalState({ user: { name: 'Ada' } });
      await waitUntil(() => stateOf(b, a) !== undefined);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(server.awarenessMessagesReceived() - before).toBe(1); // only A's own announcement
      a.destroy();
      b.destroy();
    });

    it('tells the others when it is destroyed, and drops its own state', async () => {
      const a = new YjsWebsocketClient(board('bye'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('bye'), new Y.Doc(), options);
      a.awareness.setLocalState({ user: { name: 'Ada' } });
      await waitUntil(() => stateOf(b, a) !== undefined);

      a.destroy();

      await waitUntil(() => stateOf(b, a) === undefined);
      expect(a.awareness.getLocalState()).toBeNull();
      b.destroy();
    });

    it('forgets the others when the connection drops and announces its own state again after the reconnect', async () => {
      const a = new YjsWebsocketClient(board('flaky'), new Y.Doc(), options);
      const b = new YjsWebsocketClient(board('flaky'), new Y.Doc(), options);
      a.awareness.setLocalState({ user: { name: 'Ada' } });
      b.awareness.setLocalState({ user: { name: 'Linus' } });
      await waitUntil(() => stateOf(a, b) !== undefined && stateOf(b, a) !== undefined);

      // The window in which nobody is known is short, so record it instead of polling for it.
      let bLostA = false;
      let aLostB = false;
      b.awareness.on('change', () => (bLostA ||= stateOf(b, a) === undefined));
      a.awareness.on('change', () => (aLostB ||= stateOf(a, b) === undefined));

      server.dropConnections();

      await waitUntil(() => bLostA && aLostB);
      expect(a.awareness.getLocalState()).toEqual({ user: { name: 'Ada' } }); // one's own state stays

      // Back online: both announce themselves again and see each other.
      await waitUntil(() => stateOf(b, a) !== undefined && stateOf(a, b) !== undefined);
      expect(stateOf(b, a)).toEqual({ user: { name: 'Ada' } });
      expect(stateOf(a, b)).toEqual({ user: { name: 'Linus' } });
      a.destroy();
      b.destroy();
    });

    it('does not announce a client that has no state', async () => {
      const a = new YjsWebsocketClient(board('empty'), new Y.Doc(), options);
      a.awareness.setLocalState(null);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const before = server.awarenessMessagesReceived();

      server.dropConnections();
      await new Promise((resolve) => setTimeout(resolve, 400)); // reconnected by now

      expect(server.awarenessMessagesReceived()).toBe(before);
      a.destroy();
    });
  });
});
