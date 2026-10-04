# 0003 — .NET 10 for the business backend

## Status

Accepted

## Context

The business backend owns domain logic, persistence, templates, and export services, exposed only internally (via gateway/BFF). .NET 10 SDK (10.0.101) is already installed locally.

## Decision

- `apps/business-backend` targets **net10.0**, ASP.NET Core Web API.
- Central Package Management (`Directory.Packages.props`) and `Directory.Build.props` from the start (see `dotnet-create-solution` skill conventions).

## Consequences

- No internet-facing exposure for this service; all external traffic comes through the gateway/BFF per ADR 0001.
