using Elysion.BusinessBackend.Api.Identity;

using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;

namespace Elysion.BusinessBackend.Api.Logging;

/// <summary>
/// Why a bearer token was refused, logged at warning (ADR 0025): the reason, the scheme that failed (a user's token or
/// the realtime service's internal one) and the type of the exception. Never the token, and never the exception's
/// message, which can quote claims.
/// </summary>
public static partial class AuthenticationFailureLog
{
    public static void TokenRejected(AuthenticationFailedContext context)
    {
        // The default scheme authenticates every request; on the internal API it is the Internal scheme that counts, and a
        // line saying that "Bearer" refused the realtime service's token would only confuse.
        if (context.Scheme.Name == JwtBearerDefaults.AuthenticationScheme &&
            RequiresInternalPolicy(context.HttpContext))
        {
            return;
        }

        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Elysion.BusinessBackend.Api.Authentication");
        TokenRejected(logger, ReasonOf(context.Exception), context.Scheme.Name, context.Exception.GetType().Name);
    }

    /// <summary>A request to the internal document API without any token: the challenge, not a failed validation.</summary>
    public static void TokenMissing(JwtBearerChallengeContext context)
    {
        if (context.AuthenticateFailure is not null)
        {
            return; // a rejected token is already logged with its reason
        }

        var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Elysion.BusinessBackend.Api.Authentication");
        TokenMissing(logger, context.Scheme.Name);
    }

    private static bool RequiresInternalPolicy(HttpContext context) =>
        context.GetEndpoint()
            ?.Metadata.GetOrderedMetadata<IAuthorizeData>()
            .Any(data => data.Policy == InternalApiOptions.Policy) == true;

    public static string ReasonOf(Exception exception) => exception switch
    {
        SecurityTokenExpiredException => "expired",
        SecurityTokenNotYetValidException => "not_yet_valid",
        SecurityTokenInvalidAudienceException => "wrong_audience",
        SecurityTokenInvalidIssuerException => "wrong_issuer",
        SecurityTokenInvalidAlgorithmException => "wrong_algorithm",
        SecurityTokenInvalidSignatureException or SecurityTokenSignatureKeyNotFoundException => "invalid_signature",
        SecurityTokenMalformedException or SecurityTokenArgumentException or ArgumentException => "malformed",
        _ => "invalid",
    };

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Bearer token rejected: {Reason} (scheme {Scheme}, {ExceptionType})")]
    private static partial void TokenRejected(ILogger logger, string reason, string scheme, string exceptionType);

    [LoggerMessage(Level = LogLevel.Warning, Message = "No bearer token on a request that needs one (scheme {Scheme})")]
    private static partial void TokenMissing(ILogger logger, string scheme);
}
