import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MARKER, withOtlpAccessLog } from '../../scripts/traefik-logs-config.mjs';

const ENDPOINT = 'http://victorialogs:9428/insert/opentelemetry/v1/logs';
const base = readFileSync(new URL('../../infra/traefik/traefik.yml', import.meta.url), 'utf8');

describe('Traefik static config with the log viewer', () => {
  it('has the marker in the committed file, inside accessLog', () => {
    const accessLog = base.slice(base.indexOf('\naccessLog:'));
    assert.match(accessLog, MARKER);
    assert.equal(base.indexOf('logs:otlp') > base.indexOf('\naccessLog:'), true);
  });

  it('adds the export to the access log, keeps stdout and turns the experimental switch on', () => {
    const generated = withOtlpAccessLog(base, ENDPOINT);

    assert.match(
      generated,
      /\n {2}dualOutput: true\n {2}otlp:\n {4}serviceName: elysion-traefik\n/,
    );
    assert.match(generated, new RegExp(`endpoint: ${ENDPOINT.replaceAll('/', '\\/')}\\n`));
    assert.match(generated, /VL-Stream-Fields: service\.name\n/);
    assert.match(generated, /\nexperimental:\n {2}otlpLogs: true\n$/);
    assert.doesNotMatch(generated, /logs:otlp/);
  });

  it('keeps the query parameters dropped, so the WS token of /yjs stays out of the viewer', () => {
    assert.match(withOtlpAccessLog(base, ENDPOINT), /queryParameters:\n {6}defaultMode: drop/);
  });

  it('changes nothing else in the file', () => {
    const generated = withOtlpAccessLog(base, ENDPOINT);
    const lines = (text) => text.split('\n').filter((line) => !line.includes('logs:otlp'));
    for (const line of lines(base).filter((l) => l.trim() !== '')) {
      assert.ok(generated.includes(line), `lost: ${line}`);
    }
  });

  it('refuses a file without the marker instead of silently shipping nothing', () => {
    assert.throws(() => withOtlpAccessLog('accessLog:\n  format: json\n', ENDPOINT), /marker/);
  });
});
