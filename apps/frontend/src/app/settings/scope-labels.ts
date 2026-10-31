/** What a scope of the public API allows, in the words of the interface (#851). An unknown scope is shown as itself. */
export function describeScope(scope: string): string {
  switch (scope) {
    case 'boards:read':
      return $localize`:@@tokens.scope.boardsRead:Read boards, rooms, members and versions`;
    case 'boards:write':
      return $localize`:@@tokens.scope.boardsWrite:Create, rename, duplicate and delete boards`;
    case 'members:write':
      return $localize`:@@tokens.scope.membersWrite:Add, change and remove members`;
    case 'snapshots:write':
      return $localize`:@@tokens.scope.snapshotsWrite:Save versions of boards`;
    case 'webhooks:write':
      return $localize`:@@tokens.scope.webhooksWrite:Register webhooks`;
    default:
      return scope;
  }
}
