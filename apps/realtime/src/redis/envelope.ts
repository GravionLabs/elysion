/** The largest relay message read: a bit over the 16 MiB a WebSocket frame may carry, as base64 in JSON. */
const MAX_ENVELOPE_CHARS = 24 * 1024 * 1024;

export interface Envelope {
  readonly from: string;
  readonly type: string | undefined;
  readonly data: Uint8Array;
}

/**
 * What an instance published on a relay channel (`{ from, type?, data }`, `data` as base64), or `null` when the message
 * is anything else. Valkey is a network service: a message that is not valid JSON, has no `from` or `data`, or has an
 * unknown `type` is dropped here and never reaches the room code (#775, where `JSON.parse` threw inside the subscriber's
 * callback). A message that passes is not thereby trusted: that is what the password on Valkey is for.
 */
export function parseEnvelope(raw: string, types?: readonly string[]): Envelope | null {
  if (typeof raw !== 'string' || raw.length > MAX_ENVELOPE_CHARS) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { from, type, data } = value as Record<string, unknown>;
  if (typeof from !== 'string' || typeof data !== 'string') {
    return null;
  }
  if (types !== undefined && (typeof type !== 'string' || !types.includes(type))) {
    return null;
  }
  return {
    from,
    type: typeof type === 'string' ? type : undefined,
    data: new Uint8Array(Buffer.from(data, 'base64')),
  };
}

/** At most one warning every ten seconds: a flood of bad messages must not become a flood of log lines. */
export function rateLimited(log: () => void, intervalMs = 10_000): () => void {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= intervalMs) {
      last = now;
      log();
    }
  };
}
