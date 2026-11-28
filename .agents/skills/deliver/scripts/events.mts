// Progress events in the agent-events core format (GravionLabs/agent-events, SPEC.md): the loop is the
// only writer, so `seq` is gapless. Displays such as the Deliver panel of poimen read the file; the
// session reports nothing. Writing never fails the caller. The types and fields of the loop are a contract,
// documented in the SKILL.md of `deliver`; the profile `deliver@2` is `schema/deliver-profile.schema.json`.
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type Emit = (type: string, body?: Record<string, unknown>, tone?: Tone) => void;

/** A UUIDv7 (RFC 9562): the run id of the events, unique across hosts and repositories. */
export function uuid7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

// the start of a reason of the loop; a note of a session is only ever appended to it
const STARTS: [string, string][] = [
  ['needs-decision', 'needs-decision'],
  ['session failed', 'session-failed'],
  ['session timeout', 'session-timeout'],
  ['risk ', 'merge-risk'],
  ['session ended without a pull request', 'no-pull-request'],
  ['review failed', 'review-failed'],
  ['red: ', 'checks-red'],
  ['checks did not finish', 'checks-timeout'],
  ['merge refused', 'merge-refused'],
  ['tracker error', 'tracker-error'],
  ['pull request closed', 'closed'],
  ['conflict with', 'conflict'],
  ['conflicts with', 'conflict'],
  ['error: ', 'error'],
];
// a hand-over reason may follow the note of a conflict repair
const PARTS: [string, string][] = [
  ['changes protected paths', 'protected-paths'],
  ['more than one open pull request', 'multiple-pulls'],
  ['pushed after the review', 'pushed-after-review'],
];

/**
 * The machine-readable code of the reason of a `deliver.handover` or `deliver.aside` event, prefixed with the
 * profile name; `deliver.other` for a reason without a code of its own.
 */
export function reasonCode(reason: string): string {
  const found =
    STARTS.find(([start]) => reason.startsWith(start)) ??
    PARTS.find(([part]) => reason.includes(part));
  return `deliver.${found?.[1] ?? 'other'}`;
}

/** `dir` is the events directory (event-dir.mts), none writes nothing; the file is `<run>.jsonl`. */
export function openEvents(dir: string | undefined, run: string): Emit {
  if (!dir) return () => undefined;
  let seq = 0;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // the first write reports nothing either
  }
  return (type, body = {}, tone = 'neutral') => {
    seq += 1;
    const event = { v: 1, seq, ts: new Date().toISOString(), run, type, tone, ...body };
    try {
      appendFileSync(path.join(dir, `${run}.jsonl`), `${JSON.stringify(event)}\n`);
    } catch {
      // a display must not stop a delivery
    }
  };
}
