import * as decoding from 'lib0/decoding';
import { MESSAGE_VOTING } from '../yjs/protocol.js';
import { encodeVotingMessage, parseVotingNotification } from './voting-broadcast.js';

const open = {
  id: 'v1',
  name: 'Top ideas',
  votesPerPerson: 3,
  status: 'open',
  named: false,
  startedBy: { id: 'u1', name: 'Ada' },
  startedAt: '2026-10-11T10:00:00Z',
  closedAt: null,
  placed: { u1: 2, u2: 0 },
};

describe('parseVotingNotification', () => {
  it('accepts an open voting with how many votes each person placed', () => {
    expect(parseVotingNotification({ event: 'vote', voting: open })).toEqual({
      event: 'vote',
      voting: open,
    });
  });

  it('accepts a closed voting with counts, and with voters when it is named', () => {
    const closed = {
      ...open,
      status: 'closed',
      named: true,
      closedAt: '2026-10-11T10:05:00Z',
      placed: undefined,
      result: [{ elementId: 'e1', count: 2, voters: [{ id: 'u1', name: 'Ada' }] }],
    };
    const parsed = parseVotingNotification({ event: 'close', voting: closed });
    expect(parsed?.voting?.result).toEqual(closed.result);
  });

  it('accepts clear with no voting', () => {
    expect(parseVotingNotification({ event: 'clear', voting: null })).toEqual({
      event: 'clear',
      voting: null,
    });
    expect(parseVotingNotification({ event: 'clear' })?.voting).toBeNull();
  });

  it('passes on only the known fields', () => {
    const parsed = parseVotingNotification({
      event: 'start',
      voting: { ...open, myElementVotes: { e1: 1 }, secret: 'x' },
    });
    expect(parsed?.voting).toEqual(open);
  });

  it.each([
    ['not an object', 'text'],
    ['an unknown event', { event: 'delete', voting: open }],
    ['no voting on a vote', { event: 'vote', voting: null }],
    ['a voting that is no object', { event: 'vote', voting: 'x' }],
    ['a status that is none', { event: 'vote', voting: { ...open, status: 'paused' } }],
    ['votes that are no number', { event: 'vote', voting: { ...open, votesPerPerson: '3' } }],
    ['a time that is none', { event: 'vote', voting: { ...open, startedAt: 'yesterday' } }],
    ['placed with a text', { event: 'vote', voting: { ...open, placed: { u1: 'many' } } }],
    [
      'a result without a count',
      { event: 'close', voting: { ...open, result: [{ elementId: 'e' }] } },
    ],
    ['a too long name', { event: 'vote', voting: { ...open, name: 'x'.repeat(201) } }],
  ])('refuses %s', (_name, body) => {
    expect(parseVotingNotification(body)).toBeNull();
  });
});

describe('encodeVotingMessage', () => {
  it('is message type 5 followed by the JSON as a var string', () => {
    const decoder = decoding.createDecoder(encodeVotingMessage('{"a":"é"}'));
    expect(decoding.readVarUint(decoder)).toBe(MESSAGE_VOTING);
    expect(decoding.readVarString(decoder)).toBe('{"a":"é"}');
    expect(decoding.hasContent(decoder)).toBe(false);
  });
});
