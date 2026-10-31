// The Aspire AppHost of the development stack (#867, see the ADR "Aspire AppHost for local development"): what
// `pnpm dev:infra` starts, on the same host ports as docker-compose.dev.yml, plus the business backend, with the Aspire
// dashboard for logs and state. `pnpm dev:aspire` runs it. The Node apps keep running on the host with their `.env`.
// Development credentials only, the same as docker-compose.yml's; docker-compose.yml and the Helm chart are unchanged.
#:sdk Aspire.AppHost.Sdk@13.6.4
#:package Aspire.Hosting.PostgreSQL@13.6.4
#:package Aspire.Hosting.Valkey@13.6.4
#:package Aspire.Hosting.Keycloak@13.6.4-preview.1.26523.11

// WithoutHttpsCertificate (Keycloak below) is still marked experimental in Aspire 13.6.
#pragma warning disable ASPIRECERTIFICATES001

var builder = DistributedApplication.CreateBuilder(args);

// Postgres 18 keeps its data in /var/lib/postgresql, not in Aspire's default .../data (apps/business-backend/AGENTS.md).
var postgres = builder
    .AddPostgres("postgres",
        builder.AddParameter("postgres-user", "elysion"),
        builder.AddParameter("postgres-password", "elysion", secret: true),
        port: 5432)
    .WithImageTag("18-alpine")
    .WithVolume("elysion-aspire-postgres", "/var/lib/postgresql");
var database = postgres.AddDatabase("elysion");

// The realtime relay; 6380 like docker-compose.dev.yml, so apps/realtime/.env.example works unchanged (ADR 0023).
var valkey = builder.AddValkey("valkey", port: 6380,
    password: builder.AddParameter("valkey-password", "dev-only-valkey-password", secret: true));

// The issuer is the address the browser uses, localhost:8081, so the port is fixed. Keycloak keeps its own database in
// the volume (dev-file) instead of Postgres: the realms come from infra/keycloak on a fresh volume either way.
var keycloak = builder
    .AddKeycloak("keycloak", port: 8081,
        adminUsername: builder.AddParameter("keycloak-admin", "admin"),
        adminPassword: builder.AddParameter("keycloak-admin-password", "admin", secret: true))
    .WithImageTag("26.6")
    // Aspire switches the endpoint to HTTPS when a developer certificate exists; the issuer is http://localhost:8081.
    .WithoutHttpsCertificate()
    .WithDataVolume("elysion-aspire-keycloak")
    .WithRealmImport("../../infra/keycloak")
    // The stand-in for Microsoft Entra ID (ADR 0027), as in docker-compose.yml; Keycloak calls itself on its container port.
    .WithEnvironment("ENTRA_ENABLED", "true")
    .WithEnvironment("ENTRA_CLIENT_ID", "elysion-broker")
    .WithEnvironment("ENTRA_CLIENT_SECRET", "elysion-broker-dev-secret")
    .WithEnvironment("ENTRA_ISSUER_URL", "http://localhost:8081/realms/entra-stub")
    .WithEnvironment("ENTRA_AUTH_URL", "http://localhost:8081/realms/entra-stub/protocol/openid-connect/auth")
    .WithEnvironment("ENTRA_TOKEN_URL", "http://localhost:8080/realms/entra-stub/protocol/openid-connect/token")
    .WithEnvironment("ENTRA_JWKS_URL", "http://localhost:8080/realms/entra-stub/protocol/openid-connect/certs")
    .WithEnvironment("ENTRA_ADMIN_GROUP_ID", "22222222-2222-4222-8222-222222222222");

// The object store of board files (ADR 0007); 9100 and 9101 like docker-compose.dev.yml.
var rustfs = builder
    .AddContainer("rustfs", "rustfs/rustfs", "1.0.1")
    .WithEnvironment("RUSTFS_ACCESS_KEY", "elysion")
    .WithEnvironment("RUSTFS_SECRET_KEY", "elysion123")
    .WithEnvironment("RUSTFS_CONSOLE_ENABLE", "true")
    .WithVolume("elysion-aspire-rustfs", "/data")
    .WithHttpEndpoint(port: 9100, targetPort: 9000, name: "s3")
    .WithHttpEndpoint(port: 9101, targetPort: 9001, name: "console");

// The launch profile `http` gives the port the BFF expects (5174) and the Development environment, so the backend still
// reads INTERNAL_API_SECRET from its user secrets (`pnpm setup:env`): setting it here would split it from the realtime one.
builder
    .AddProject("business-backend",
        "../business-backend/src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj",
        launchProfileName: "http")
    .WithReference(database, "Elysion")
    .WithEnvironment("S3_ENDPOINT", rustfs.GetEndpoint("s3"))
    .WithEnvironment("REALTIME_URL", "http://localhost:3000")
    .WithOtlpExporter(OtlpProtocol.HttpProtobuf)
    .WithEnvironment(context =>
    {
        // The backend sends logs only to a signal-specific endpoint (ADR 0025); point it at the dashboard.
        if (context.EnvironmentVariables.TryGetValue("OTEL_EXPORTER_OTLP_ENDPOINT", out var endpoint))
        {
            // The dashboard's endpoint is a reference that is resolved when the backend starts, not a string yet.
            context.EnvironmentVariables["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] = endpoint is EndpointReference reference
                ? ReferenceExpression.Create($"{reference}/v1/logs")
                : $"{endpoint}".TrimEnd('/') + "/v1/logs";
        }
        if (context.EnvironmentVariables.TryGetValue("OTEL_EXPORTER_OTLP_HEADERS", out var headers))
        {
            context.EnvironmentVariables["OTEL_EXPORTER_OTLP_LOGS_HEADERS"] = headers;
        }
    })
    .WithHttpHealthCheck("/health")
    .WaitFor(database)
    .WaitFor(keycloak)
    .WaitFor(rustfs);

builder.Build().Run();
