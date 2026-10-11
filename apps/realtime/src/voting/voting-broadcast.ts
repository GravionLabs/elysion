import * as encoding from 'lib0/encoding';
import { MESSAGE_VOTING } from '../yjs/protocol.js';

/** What the business backend announces after a change of a board's voting (ADR 0029). */
export const VOTING_EVENTS = ['start', 'vote', 'retract', 'close', 'clear'] as const;
export type VotingEvent = (typeof VOTING_EVENTS)[number];

const MAX_TEXT = 200;
const MAX_ENTRIES = 10_000;

/**
 * The voting as every client of the board may see it: the `VotingView` of the backend without the caller's own votes.
 * `placed` (open voting) says how many votes each person has placed, not on what; `result` (closed voting) has counts per
 * element and, when the voting is named, the voters.
 */
export interface VotingBroadcast {
  id: string;
  name: string;
  votesPerPerson: number;
  status: 'open' | 'closed';
  named: boolean;
  startedBy: { id: string; name: string };
  startedAt: string;
  closedAt: string | null;
  placed?: Record<string, number>;
  result?: Array<{
    elementId: string;
    count: number;
    voters?: Array<{ id: string; name: string }>;
  }>;
}

export interface VotingNotification {
  event: VotingEvent;
  voting: VotingBroadcast | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;
const isTime = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));

function person(value: unknown): { id: string; name: string } | null {
  return isObject(value) && isText(value['id']) && isText(value['name'])
    ? { id: value['id'], name: value['name'] }
    : null;
}

function parseVoting(value: unknown): VotingBroadcast | null {
  if (!isObject(value)) return null;
  const startedBy = person(value['startedBy']);
  const closedAt = value['closedAt'] ?? null;
  if (
    !isText(value['id']) ||
    !isText(value['name']) ||
    !isCount(value['votesPerPerson']) ||
    (value['status'] !== 'open' && value['status'] !== 'closed') ||
    typeof value['named'] !== 'boolean' ||
    !startedBy ||
    !isTime(value['startedAt']) ||
    (closedAt !== null && !isTime(closedAt))
  ) {
    return null;
  }
  const voting: VotingBroadcast = {
    id: value['id'],
    name: value['name'],
    votesPerPerson: value['votesPerPerson'],
    status: value['status'],
    named: value['named'],
    startedBy,
    startedAt: value['startedAt'],
    closedAt,
  };
  if (value['placed'] !== undefined) {
    if (!isObject(value['placed'])) return null;
    const entries = Object.entries(value['placed']);
    if (
      entries.length > MAX_ENTRIES ||
      !entries.every(([id, n]) => id.length <= MAX_TEXT && isCount(n))
    ) {
      return null;
    }
    voting.placed = Object.fromEntries(entries) as Record<string, number>;
  }
  if (value['result'] !== undefined) {
    if (!Array.isArray(value['result']) || value['result'].length > MAX_ENTRIES) return null;
    const result: NonNullable<VotingBroadcast['result']> = [];
    for (const entry of value['result'] as unknown[]) {
      if (!isObject(entry) || !isText(entry['elementId']) || !isCount(entry['count'])) return null;
      const item: NonNullable<VotingBroadcast['result']>[number] = {
        elementId: entry['elementId'],
        count: entry['count'],
      };
      if (entry['voters'] !== undefined) {
        if (!Array.isArray(entry['voters']) || entry['voters'].length > MAX_ENTRIES) return null;
        const voters = (entry['voters'] as unknown[]).map(person);
        if (voters.some((voter) => voter === null)) return null;
        item.voters = voters as Array<{ id: string; name: string }>;
      }
      result.push(item);
    }
    voting.result = result;
  }
  return voting;
}

/**
 * The body of the backend's call, checked field by field; only the known fields are passed on. `null` when it is not valid.
 * Every event but `clear` carries the voting; `clear` carries none (or the open one that stays).
 */
export function parseVotingNotification(body: unknown): VotingNotification | null {
  if (!isObject(body)) return null;
  const event = VOTING_EVENTS.find((e) => e === body['event']);
  if (!event) return null;
  const raw = body['voting'] ?? null;
  const voting = raw === null ? null : parseVoting(raw);
  if (raw !== null && voting === null) return null;
  if (event !== 'clear' && voting === null) return null;
  return { event, voting };
}

/** The frame a client receives: message type 5 followed by the JSON as a var string. */
export function encodeVotingMessage(json: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_VOTING);
  encoding.writeVarString(encoder, json);
  return encoding.toUint8Array(encoder);
}
