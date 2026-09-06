FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props Directory.Packages.props Elysion.BusinessBackend.slnx ./
COPY src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj src/Elysion.BusinessBackend.Api/
RUN dotnet restore src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj
COPY src/Elysion.BusinessBackend.Api/ src/Elysion.BusinessBackend.Api/
RUN dotnet publish src/Elysion.BusinessBackend.Api/Elysion.BusinessBackend.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENTRYPOINT ["dotnet", "Elysion.BusinessBackend.Api.dll"]
