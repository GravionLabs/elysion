// The Traefik static configuration for `pnpm dev:logs` and for a second dev stack (`forStack`, below): infra/traefik/traefik.yml plus the export of the access log to the
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

// A second dev stack (#890): Traefik routes over that project's network and sees only that project's containers, because
// every stack's services carry the same router names. The committed file names the default project, `elysion`.
export const STACK_NETWORK = /^ {4}network: elysion_elysion$/m;
export const STACK_CONSTRAINT =
  /^ {4}constraints: 'Label\(`com\.docker\.compose\.project`,`elysion`\)'$/m;

/** @param {string} yaml the content of traefik.yml  @param {string} stack the compose project name */
export function forStack(yaml, stack) {
  if (!STACK_NETWORK.test(yaml) || !STACK_CONSTRAINT.test(yaml)) {
    throw new Error(
      'infra/traefik/traefik.yml has lost the network or the constraints line of the stack `elysion` in providers.docker',
    );
  }
  return yaml
    .replace(STACK_NETWORK, `    network: ${stack}_elysion`)
    .replace(
      STACK_CONSTRAINT,
      `    constraints: 'Label(\`com.docker.compose.project\`,\`${stack}\`)'`,
    );
}

/**
 * The generated static configuration of a stack, or null when the committed file serves (the default stack without the
 * log export). `withLogs` is `pnpm dev:logs`; without it (`dev:infra`, `dev:stack`, `dev:env`) it is the stack's plain one.
 * `keep` is for `dev:env`, which only exports the path: a file already generated for this stack, with or without the log
 * export, stays as it is, so that a shell's next `docker compose` does not recreate a `dev:logs` Traefik without its export.
 * @param {string} yaml the content of traefik.yml  @param {string} stack the compose project name
 * @param {{ withLogs?: boolean, endpoint: string, existing?: string, keep?: boolean }} options
 */
export function generatedConfig(
  yaml,
  stack,
  { withLogs = false, endpoint, existing, keep = false },
) {
  const plain = stack === 'elysion' ? yaml : forStack(yaml, stack);
  const logged = withOtlpAccessLog(plain, endpoint);
  if (keep && stack !== 'elysion' && (existing === plain || existing === logged)) return existing;
  if (withLogs) return logged;
  return stack === 'elysion' ? null : plain;
}
