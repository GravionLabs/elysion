using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data.Repositories;

namespace Elysion.BusinessBackend.Api.Graph;

/// <summary>The outcome of one run: how many groups were read, how many failed and how many changed.</summary>
public sealed record GraphSyncRun(int Groups, int Failed, int Changed);

/// <summary>
/// One run of the Graph sync (#667): for every linked group, read its name and its transitive members and make the database agree
/// (<see cref="IGroupSyncRepository.ApplyAsync"/>). One group that fails (the directory answers 404 or 500, a page link is refused)
/// is logged and left as it was; the others go on. Every changed group gets one audit entry without the actor (the system) and without
/// any address.
/// </summary>
public sealed class GraphGroupSync(
    IGraphClient graph,
    IGroupSyncRepository store,
    IAuditLog audit,
    TimeProvider time,
    ILogger<GraphGroupSync> logger)
{
    public async Task<GraphSyncRun> RunAsync(CancellationToken cancellationToken)
    {
        var groups = await store.ListLinkedAsync(cancellationToken);
        var failed = 0;
        var changed = 0;
        foreach (var group in groups)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var name = await graph.GetGroupNameAsync(group.ExternalId!, cancellationToken);
                var members = await graph.GetMembersAsync(group.ExternalId!, cancellationToken);
                var result = await store.ApplyAsync(group.Id,
                    name,
                    members,
                    time.GetUtcNow(),
                    r => audit.Record(AuditActions.GroupGraphSynced,
                        AuditActions.Group,
                        group.Id,
                        new
                        {
                            renamed = r.Renamed, added = r.Added, removed = r.Removed, pendingAdded = r.PendingAdded,
                            pendingRemoved = r.PendingRemoved
                        }),
                    cancellationToken);
                if (result.Changed)
                {
                    changed++;
                }
            }
            catch (GraphException e)
            {
                failed++;
                logger.LogWarning("The sync of group {GroupId} failed: {Reason}", group.Id, e.Message);
            }
        }

        return new GraphSyncRun(groups.Count, failed, changed);
    }
}
