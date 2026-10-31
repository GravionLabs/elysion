import { type AuditEntry, describeAuditEntry } from './audit';

const entry = (action: string, details: Record<string, unknown> | null = null): AuditEntry => ({
  id: 'e1',
  at: '2026-10-05T12:00:00Z',
  action,
  subjectType: 'board',
  subjectId: 'b1',
  subjectName: 'Retro',
  actor: { id: 'u1', displayName: 'Ada' },
  target: { id: 'u2', displayName: 'Bob' },
  details,
  requestId: null,
});

describe('describeAuditEntry', () => {
  it.each([
    ['member.added', { role: 'Viewer' }, 'Ada gave Bob the role Viewer'],
    [
      'member.role_changed',
      { from: 'Viewer', to: 'Editor' },
      'Ada changed the role of Bob from Viewer to Editor',
    ],
    ['member.removed', { role: 'Editor' }, 'Ada removed Bob'],
    [
      'room.group_role_set',
      { groupName: 'Staff', role: 'Editor' },
      'Ada gave the group Staff the role Editor',
    ],
    ['room.group_role_removed', { groupId: 'g' }, 'Ada took a group out of the room'],
    ['group.created', { name: 'Staff' }, 'Ada created the group Staff'],
    ['group.renamed', { from: 'A', to: 'B' }, 'Ada renamed the group from A to B'],
    ['group.linked', { externalId: 'x' }, 'Ada linked the group to the identity provider'],
    ['group.unlinked', null, 'Ada unlinked the group from the identity provider'],
    ['group.deleted', { name: 'Staff' }, 'Ada deleted the group Staff'],
    ['owner.transferred', { userId: 'u2' }, 'Ada handed the ownership over to Bob'],
    ['group.member_added', { userId: 'u2' }, 'Ada added Bob to the group'],
    ['group.member_removed', { userId: 'u2' }, 'Ada took Bob out of the group'],
    [
      'groups.synced',
      { added: 2, removed: 1 },
      'The groups of Ada from the identity provider changed: 2 added, 1 removed',
    ],
    ['invitation.created', { role: 'Viewer' }, 'Ada made an invitation link for the role Viewer'],
    ['invitation.revoked', { invitationId: 'i' }, 'Ada revoked an invitation link'],
    ['invitation.accepted', { role: 'Editor' }, 'Ada joined with an invitation link as Editor'],
    [
      'snapshot.deleted',
      { snapshotId: 's', kind: 'Manual' },
      'Ada deleted a saved version of the board',
    ],
    ['snapshot.restored', { snapshotId: 's' }, 'Ada restored a version of the board'],
  ])('says what %s is', (action, details, sentence) => {
    expect(describeAuditEntry(entry(action, details))).toBe(sentence);
  });

  it('names an unknown person and an unknown action', () => {
    const lost = { ...entry('member.added', { role: 'Viewer' }), actor: null, target: null };
    expect(describeAuditEntry(lost)).toBe('Somebody gave a person the role Viewer');
    expect(describeAuditEntry(entry('something.new'))).toBe('Ada: something.new');
  });

  it('names the person a deactivation or reactivation is about by the subject of the entry', () => {
    const about = (action: string): AuditEntry => ({
      ...entry(action),
      subjectType: 'user',
      subjectId: 'u2',
      subjectName: 'Bob',
      target: null,
    });

    expect(describeAuditEntry(about('user.deactivated'))).toBe('Ada deactivated Bob');
    expect(describeAuditEntry(about('user.reactivated'))).toBe('Ada reactivated Bob');
  });
});
