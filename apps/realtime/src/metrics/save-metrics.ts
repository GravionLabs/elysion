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

  readonly #durations = new Histogram({
    name: 'elysion_realtime_document_save_duration_seconds',
    help: 'How long a save of a board document to the business backend takes, in seconds (the whole exchange, with a merge after a conflict).',
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  /** Starts timing a save; call the result when it ends, saved or not. */
  startSave(): () => void {
    const end = this.#durations.startTimer();
    return () => {
      end();
    };
  }

  readonly #compactions = new Counter({
    name: 'elysion_realtime_document_compactions_total',
    help: 'Board documents rebuilt from their live elements when nobody had them open (ADR 0026).',
    registers: [this.registry],
  });

  readonly #refused = new Counter({
    name: 'elysion_realtime_document_updates_refused_total',
    help: 'Client updates refused: over the size of one update or over the size of the document (ADR 0026).',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  compacted(): void {
    this.#compactions.inc();
  }

  refused(reason: 'update' | 'document'): void {
    this.#refused.inc({ reason });
  }

  saved(bytes: number): void {
    this.#saves.inc();
    this.#sizes.observe(bytes);
  }

  failed(): void {
    this.#failures.inc();
  }
}
