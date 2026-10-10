import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics of the BFF, served at `GET /metrics` (docs/specs/gateway.md): the process's own (CPU,
 * memory, event loop) and, for every HTTP request, a count and a duration by method, route and status.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly #requests = new Counter({
    name: 'elysion_bff_http_requests_total',
    help: 'HTTP requests answered, by method, route and status code.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  readonly #durations = new Histogram({
    name: 'elysion_bff_http_request_duration_seconds',
    help: 'Time from receiving a request to the end of its answer, in seconds.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  readonly #tokenRefusals = new Counter({
    name: 'elysion_bff_realtime_token_refusals_total',
    help: 'Realtime tokens refused, by reason (not_uuid: the id is no stored board; no_role: the caller has no role on it).',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /**
   * One finished request. `route` is the route pattern (`/api/boards/:id`), never the URL: ids and query strings
   * (which can carry tokens) must not become label values, and each value is a new time series.
   */
  observe(method: string, route: string, statusCode: number, seconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.#requests.inc(labels);
    this.#durations.observe(labels, seconds);
  }

  /** A realtime token that was refused with 403; a jump of this is a client or a script probing board ids. */
  realtimeTokenRefused(reason: 'not_uuid' | 'no_role'): void {
    this.#tokenRefusals.inc({ reason });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
