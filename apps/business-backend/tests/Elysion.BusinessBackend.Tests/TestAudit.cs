using Elysion.BusinessBackend.Api.Audit;
using Elysion.BusinessBackend.Api.Data;
using Elysion.BusinessBackend.Api.Data.Repositories;
using Elysion.BusinessBackend.Api.Identity;
using Elysion.BusinessBackend.Api.Webhooks;

using Microsoft.AspNetCore.Http;

using NSubstitute;

namespace Elysion.BusinessBackend.Tests;

/// <summary>The audit log as the app builds it, for tests that build a service by hand: entries are staged on <paramref name="db"/>.</summary>
internal static class TestAudit
{
    public static AuditLog For(ElysionDbContext db, Guid? actor = null, TimeProvider? time = null)
    {
        var user = Substitute.For<ICurrentUser>();
        if (actor is { } id)
        {
            user.Id.Returns(id);
        }
        else
        {
            user.Id.Returns(_ => throw new InvalidOperationException("There is no current user."));
        }

        return new AuditLog(db, user, new HttpContextAccessor(), time ?? TimeProvider.System);
    }

    /// <summary>The webhook outbox as the app builds it: deliveries are staged on <paramref name="db"/>.</summary>
    public static WebhookEvents Webhooks(ElysionDbContext db, Guid? actor = null, TimeProvider? time = null)
    {
        var user = Substitute.For<ICurrentUser>();
        if (actor is { } id)
        {
            user.Id.Returns(id);
        }
        else
        {
            user.Id.Returns(_ => throw new InvalidOperationException("There is no current user."));
        }

        return new WebhookEvents(new WebhookRepository(db), user, time ?? TimeProvider.System);
    }
}
