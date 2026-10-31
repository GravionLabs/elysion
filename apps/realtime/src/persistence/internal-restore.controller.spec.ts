import { parseRestoreRequest } from './internal-restore.controller.js';

const valid = {
  snapshotId: '0199b0c2-1d3e-7a4b-8c5d-6e7f8091a2b3',
  by: 'Ada',
  at: '2026-10-31T10:00:00Z',
};

describe('parseRestoreRequest', () => {
  it('takes a valid request and drops unknown fields', () => {
    expect(parseRestoreRequest({ ...valid, extra: 1 })).toEqual(valid);
  });

  it.each([
    ['no object', null],
    ['an array', []],
    ['an id that is no UUID', { ...valid, snapshotId: 'x' }],
    ['no person', { ...valid, by: '' }],
    ['a person name that is too long', { ...valid, by: 'a'.repeat(201) }],
    ['a time that is none', { ...valid, at: 'yesterday' }],
    ['a time that is no text', { ...valid, at: 5 }],
  ])('refuses %s', (_name, body) => {
    expect(parseRestoreRequest(body)).toBeNull();
  });
});
