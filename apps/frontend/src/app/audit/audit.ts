/** A person named in an entry of the audit log (the name they have now). */
export interface AuditPerson {
  id: string;
  displayName: string;
}

/**
 * One line of the audit log (#669), as the BFF returns it. `details` is a small object (ids, roles, counts, group names): never a
 * token, an email address or content.
 */
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  subjectType: 'board' | 'room' | 'group' | 'user' | string;
  subjectId: string | null;
  subjectName: string | null;
  actor: AuditPerson | null;
  /** The person the change was made to, for the entries about a member. */
  target: AuditPerson | null;
  details: Record<string, unknown> | null;
  requestId: string | null;
}

function text(entry: AuditEntry, key: string): string {
  const value = entry.details?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** The sentence an entry says, in the language of the interface; an action this version does not know is shown as its own name. */
export function describeAuditEntry(entry: AuditEntry): string {
  const actor = entry.actor?.displayName ?? $localize`:@@audit.somebody:Somebody`;
  const target = entry.target?.displayName ?? $localize`:@@audit.aPerson:a person`;
  const role = text(entry, 'role');
  switch (entry.action) {
    case 'member.added':
      return $localize`:@@audit.member.added:${actor}:actor: gave ${target}:target: the role ${role}:role:`;
    case 'member.role_changed':
      return $localize`:@@audit.member.changed:${actor}:actor: changed the role of ${target}:target: from ${text(entry, 'from')}:from: to ${text(entry, 'to')}:to:`;
    case 'member.removed':
      return $localize`:@@audit.member.removed:${actor}:actor: removed ${target}:target:`;
    case 'room.group_role_set':
      return $localize`:@@audit.room.groupSet:${actor}:actor: gave the group ${text(entry, 'groupName')}:group: the role ${role}:role:`;
    case 'room.group_role_removed':
      return $localize`:@@audit.room.groupRemoved:${actor}:actor: took a group out of the room`;
    case 'group.created':
      return $localize`:@@audit.group.created:${actor}:actor: created the group ${text(entry, 'name')}:name:`;
    case 'group.renamed':
      return $localize`:@@audit.group.renamed:${actor}:actor: renamed the group from ${text(entry, 'from')}:from: to ${text(entry, 'to')}:to:`;
    case 'group.linked':
      return $localize`:@@audit.group.linked:${actor}:actor: linked the group to the identity provider`;
    case 'group.unlinked':
      return $localize`:@@audit.group.unlinked:${actor}:actor: unlinked the group from the identity provider`;
    case 'group.deleted':
      return $localize`:@@audit.group.deleted:${actor}:actor: deleted the group ${text(entry, 'name')}:name:`;
    case 'group.member_added':
      return $localize`:@@audit.group.memberAdded:${actor}:actor: added ${target}:target: to the group`;
    case 'group.member_removed':
      return $localize`:@@audit.group.memberRemoved:${actor}:actor: took ${target}:target: out of the group`;
    case 'groups.synced':
      return $localize`:@@audit.groups.synced:The groups of ${actor}:actor: from the identity provider changed: ${text(entry, 'added')}:added: added, ${text(entry, 'removed')}:removed: removed`;
    case 'user.deactivated':
      return $localize`:@@audit.user.deactivated:${actor}:actor: deactivated ${entry.subjectName ?? target}:person:`;
    case 'user.reactivated':
      return $localize`:@@audit.user.reactivated:${actor}:actor: reactivated ${entry.subjectName ?? target}:person:`;
    case 'owner.transferred':
      return $localize`:@@audit.owner.transferred:${actor}:actor: handed the ownership over to ${target}:target:`;
    case 'token.created':
      return $localize`:@@audit.token.created:${actor}:actor: made the access token “${text(entry, 'name')}:name:”`;
    case 'token.revoked':
      return $localize`:@@audit.token.revoked:${actor}:actor: revoked the access token “${text(entry, 'name')}:name:” of ${entry.subjectName ?? target}:person:`;
    case 'invitation.created':
      return $localize`:@@audit.invitation.created:${actor}:actor: made an invitation link for the role ${role}:role:`;
    case 'invitation.revoked':
      return $localize`:@@audit.invitation.revoked:${actor}:actor: revoked an invitation link`;
    case 'invitation.accepted':
      return $localize`:@@audit.invitation.accepted:${actor}:actor: joined with an invitation link as ${role}:role:`;
    case 'snapshot.deleted':
      return $localize`:@@audit.snapshot.deleted:${actor}:actor: deleted a saved version of the board`;
    case 'snapshot.restored':
      return $localize`:@@audit.snapshot.restored:${actor}:actor: restored a version of the board`;
    default:
      return `${actor}: ${entry.action}`;
  }
}
