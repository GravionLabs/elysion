import { Injectable } from '@nestjs/common';
import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { YjsRoomRegistry } from '../yjs/yjs-room-registry.js';

/**
 * Prometheus metrics of the realtime service, served at `GET /metrics` (docs/specs/gateway.md): the process's
 * own (CPU, memory, event loop) plus the open WebSocket connections and the rooms held in memory. The gauges
 * read the registry when they are scraped, so there is nothing to keep in step.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  constructor(rooms: YjsRoomRegistry) {
    collectDefaultMetrics({ register: this.registry });
    new Gauge({
      name: 'elysion_realtime_websocket_connections',
      help: 'Open WebSocket connections that were admitted to a room.',
      registers: [this.registry],
      collect() {
        this.set(rooms.stats().connections);
      },
    });
    new Gauge({
      name: 'elysion_realtime_rooms',
      help: 'Boards whose document is held in memory.',
      registers: [this.registry],
      collect() {
        this.set(rooms.stats().rooms);
      },
    });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
