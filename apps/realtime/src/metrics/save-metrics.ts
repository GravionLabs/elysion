import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

/**
 * What the persistence of the documents reports: saves, failed saves and the size of the saved state. The room
 * registry writes them, {@link MetricsService} serves them.
 */
@Injectable()
export class SaveMetrics {
  readonly registry = new Registry();

  readonly #saves = new Counter({
    name: 'elysion_realtime_document_saves_total',
    help: 'Board documents saved to the business backend.',
    registers: [this.registry],
  });

  readonly #failures = new Counter({
    name: 'elysion_realtime_document_save_failures_total',
    help: 'Saves of a board document that failed and are retried; the content stays in memory meanwhile.',
    registers: [this.registry],
  });

  readonly #sizes = new Histogram({
    name: 'elysion_realtime_document_size_bytes',
    help: 'Size of the encoded board state at each save, in bytes.',
    buckets: [10_000, 100_000, 500_000, 1_000_000, 2_000_000, 4_000_000, 8_000_000, 16_000_000],
    registers: [this.registry],
  });

  saved(bytes: number): void {
    this.#saves.inc();
    this.#sizes.observe(bytes);
  }

  failed(): void {
    this.#failures.inc();
  }
}
