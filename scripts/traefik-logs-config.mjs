// The Traefik static configuration for `pnpm dev:logs`: infra/traefik/traefik.yml plus the export of the access log to the
// log viewer (ADR 0025). Traefik reads its static configuration from one source only, so this cannot be an environment
// variable next to the file; and a copy of the file would drift. Instead the file has a marker line and this inserts the
// OTLP block at it, writing a generated copy that compose mounts in place of the original.
//
// The export is experimental in Traefik (`experimental.otlpLogs`) and keeps the JSON access log on stdout (`dualOutput`).
// The query parameters stay dropped from `RequestPath`, which is what keeps the WS token of /yjs out of the viewer.

export const MARKER = /^ {2}# logs:otlp.*$/m;

/** @param {string} yaml the content of traefik.yml  @param {string} endpoint the OTLP/HTTP logs endpoint of the viewer */
export function withOtlpAccessLog(yaml, endpoint) {
  if (!MARKER.test(yaml)) {
    throw new Error(
      'infra/traefik/traefik.yml has lost its "# logs:otlp" marker line in accessLog',
    );
  }
  const block = [
    '  dualOutput: true',
    '  otlp:',
    '    serviceName: elysion-traefik',
    '    http:',
    `      endpoint: ${endpoint}`,
    '      headers:',
    // Without this the viewer makes the detected host and process attributes the stream key.
    '        VL-Stream-Fields: service.name',
  ].join('\n');
  return `${yaml.replace(MARKER, block).trimEnd()}\n\nexperimental:\n  otlpLogs: true\n`;
}
