// The Traefik static configuration for `pnpm dev:logs`: infra/traefik/traefik.yml plus the export of the access log to the
// log viewer (ADR 0025; the Aspire dashboard since ADR 0034). Traefik reads its static configuration from one source only,
// so this cannot be an environment variable next to the file; and a copy of the file would drift. Instead the file has a
// marker line and this inserts the OTLP block at it, writing a generated copy that compose mounts in place of the original.
// The export goes over gRPC: Traefik's OTLP/HTTP exporter always compresses with gzip (there is no setting for it), and the
// Aspire dashboard's OTLP/HTTP endpoint does not decompress, so it refuses every batch as invalid protobuf (ADR 0034).
//
// The export is experimental in Traefik (`experimental.otlpLogs`) and keeps the JSON access log on stdout (`dualOutput`).
// The query parameters stay dropped and `RequestPath` is not logged, which keeps the WS token of /yjs and the invitation tokens out of the viewer.

export const MARKER = /^ {2}# logs:otlp.*$/m;

/** @param {string} yaml the content of traefik.yml  @param {string} endpoint the OTLP/gRPC endpoint of the viewer (`host:port`) */
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
    '    grpc:',
    `      endpoint: ${endpoint}`,
    // Plain gRPC on the compose network: the dashboard is dev-only and has no certificate.
    '      insecure: true',
  ].join('\n');
  return `${yaml.replace(MARKER, block).trimEnd()}\n\nexperimental:\n  otlpLogs: true\n`;
}
