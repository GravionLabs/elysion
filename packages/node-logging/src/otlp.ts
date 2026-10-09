import { Writable } from 'node:stream';

export interface OtlpOptions {
  /** `elysion-bff` or `elysion-realtime`: the `service.name` of the resource, which the viewer groups by. */
  service: string;
  /** The OTLP/HTTP logs endpoint, e.g. `http://victorialogs:9428/insert/opentelemetry/v1/logs`. */
  endpoint: string;
  /** Extra request headers, from `OTEL_EXPORTER_OTLP_LOGS_HEADERS` (`name=value,name2=value2`). */
  headers?: Record<string, string>;
}

/** `OTEL_EXPORTER_OTLP_LOGS_HEADERS`: comma-separated `name=value` pairs; anything that is not one is ignored. */
export function parseHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (value ?? '').split(',')) {
    const separator = pair.indexOf('=');
    if (separator > 0) {
      headers[pair.slice(0, separator).trim()] = decodeURIComponent(
        pair.slice(separator + 1).trim(),
      );
    }
  }
  return headers;
}

/** pino's level words as OpenTelemetry severity numbers (the first of each range, as the data model recommends). */
const SEVERITY: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

/**
 * A log line as OTLP attributes: the line's own fields with nested objects flattened to dotted names
 * (`http.route`, `err.type`), the way the viewer shows them. `timestamp`, `message` and `service` are the record's time,
 * body and resource, so they are not attributes as well. `level` is both the record's severity and an attribute: the
 * viewer's own `severity_text` would do, but the business backend's sink can only write Serilog's level names there
 * (`Warning`), and `level:warn` should find the lines of every component.
 */
export function toAttributes(
  line: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  const walk = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) {
        walk(`${prefix}.${key}`, inner);
      }
      return;
    }
    attributes[prefix] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : JSON.stringify(value);
  };
  for (const [key, value] of Object.entries(line)) {
    if (!['timestamp', 'message', 'service'].includes(key)) {
      walk(key, value);
    }
  }
  return attributes;
}

/**
 * A writable that sends each JSON log line it is given to an OTLP/HTTP logs endpoint (protobuf: VictoriaLogs and Seq
 * refuse JSON, ADR 0025) and keeps nothing else. It is the second destination next to stdout; when the viewer is down
 * the lines are dropped, never queued without bound and never a reason for the service to fail. The OpenTelemetry
 * packages are loaded when the stream is created, not when this module is imported.
 */
export function createOtlpStream(options: OtlpOptions): Writable {
  let emit: (line: Record<string, unknown>) => void = () => undefined;
  let shutdown: () => Promise<void> = async () => undefined;

  return new Writable({
    async construct(callback) {
      try {
        const [
          { SeverityNumber },
          { LoggerProvider, BatchLogRecordProcessor },
          { OTLPLogExporter },
          resources,
        ] = await Promise.all([
          import('@opentelemetry/api-logs'),
          import('@opentelemetry/sdk-logs'),
          import('@opentelemetry/exporter-logs-otlp-proto'),
          import('@opentelemetry/resources'),
        ]);
        const provider = new LoggerProvider({
          resource: resources.resourceFromAttributes({ 'service.name': options.service }),
          processors: [
            new BatchLogRecordProcessor({
              exporter: new OTLPLogExporter({
                url: options.endpoint,
                // Without this header the viewer makes the detected host and process attributes the stream key.
                headers: { 'VL-Stream-Fields': 'service.name', ...options.headers },
              }),
              scheduledDelayMillis: 1000,
              // A viewer that is down must not make the service hold on to lines: a bounded queue, then drop.
              maxQueueSize: 2048,
            }),
          ],
        });
        const logger = provider.getLogger('elysion');
        emit = (line) => {
          const level = typeof line.level === 'string' ? line.level : 'info';
          const time = typeof line.timestamp === 'string' ? new Date(line.timestamp) : new Date();
          logger.emit({
            timestamp: Number.isNaN(time.getTime()) ? new Date() : time,
            severityText: level,
            severityNumber: (SEVERITY[level] ??
              SEVERITY.info) as (typeof SeverityNumber)[keyof typeof SeverityNumber],
            body: typeof line.message === 'string' ? line.message : '',
            attributes: toAttributes(line),
          });
        };
        shutdown = () => provider.shutdown();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    write(chunk: Buffer | string, _encoding, done) {
      for (const text of String(chunk).split('\n')) {
        if (text === '') {
          continue;
        }
        try {
          emit(JSON.parse(text) as Record<string, unknown>);
        } catch {
          // Not a JSON line (nothing in the services writes one): not worth failing the log for.
        }
      }
      done();
    },
    final(callback) {
      shutdown().then(
        () => callback(),
        () => callback(),
      );
    },
  });
}
