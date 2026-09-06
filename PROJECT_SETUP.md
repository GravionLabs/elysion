
# Elysion – Projekt Setup

## Ziel
Eine Open-Source Alternative zu Mural mit Angular, React/tldraw, NestJS, Yjs und .NET.

## Architekturüberblick (Kurz)
- Frontend: Angular + React/tldraw
- Realtime: NestJS (WebSocket + Yjs)
- BFF: UI-spezifische Aggregation (NestJS empfohlen)
- API Gateway: zentrale Eintrittsstelle (TLS, Auth, Rate limiting, Routing)
- Business Backend: .NET 8 Web API
- Storage: PostgreSQL, Redis, MinIO
- Infrastruktur: Docker + Traefik (Gateway) + CI/CD

## Detaillierte Architektur

### 1. Edge / API Gateway
- Aufgaben: TLS Termination, Auth Validation (JWT/OIDC), CORS, Rate Limiting, Routing, Observability
- Routenbeispiele:
  - /api/* -> BFF
  - /realtime/* -> Realtime (WebSocket Gateway)
  - /internal/* -> Business Backend (nur intern, mTLS optional)

### 2. Backend for Frontend (BFF)
- Dünner Service, speziell für das Web-Frontend
- UI-optimierte Aggregation von Business-APIs
- Caching für UI-heavy Queries (Redis)
- Token-Exchange / Short-lived tokens für WebSocket-Handshake
- Implementierungsempfehlung: NestJS (wiederverwendbare Guards/Interceptors)

### 3. Realtime Backend (NestJS)
- WebSocket Gateway für CRDT-Synchronisation (Yjs)
- Presence Service (Redis) für Cursor/Avatare
- Session-Management und Auth-Validierung beim Handshake
- Skalierung: horizontale Instanzen + Redis für Presence

### 4. Business Backend (.NET 8)
- Domain-Logik, Persistenz, Templates, Export-Service
- Exponiert granulare REST/GRPC APIs für interne Nutzung
- Keine direkte Internet-Exposition; nur über Gateway/BFF

### 5. Storage & Persistenz
- PostgreSQL: Users, Boards, Templates, Audit Logs
- Redis: Presence, Session TTL, Cache
- MinIO: Uploads, Exports, Template-Assets

### 6. Authentifizierung & Security
- Gateway validiert OIDC/JWT; BFF erhält User-Context
- Interne Calls: service-to-service JWT oder mTLS
- WebSocket: Token-Validierung beim Handshake; optional Short-lived WS-Tokens

### 7. Observability & Operations
- Zentralisiertes Logging (ELK/Datadog), Tracing (OpenTelemetry)
- Metrics pro Route; Health Checks für Services
- Rate Limiting am Gateway; Circuit Breaker intern

### 8. Deployment & Infrastruktur
- Traefik als Edge Gateway (oder spez. API Gateway wenn benötigt)
- Container: BFF, Realtime, Business, DB, Redis, MinIO
- Orchestrierung: Docker Compose für PoC, Kubernetes für Produktion
- CI/CD: GitHub Actions / Azure DevOps Pipelines

## Datenfluss (Beispiel)
1. Web App lädt Board-Metadaten:
   - Frontend -> Gateway -> BFF -> Business Backend -> PostgreSQL
2. Echtzeit-Sync:
   - Frontend (WS) -> Gateway -> Realtime Backend (Yjs) -> andere Clients
3. Präsenz/Cursor:
   - Realtime Backend -> Redis -> Broadcast an Clients

## Vor- und Nachteile des Gateway + BFF Ansatzes
- Vorteile:
  - Zentrale Auth/Policy/Observability
  - UI-optimierte Endpunkte via BFF (weniger Roundtrips)
  - Klare Trennung von Verantwortlichkeiten
- Nachteile:
  - Zusätzliche Komponenten (BFF, Gateway) erhöhen Komplexität
  - Mehr Deployments und Operational Overhead

## Frontend Setup (Angular + React/tldraw)
- Angular Projekt erstellen
- React Canvas als Angular-Komponente einbetten
- Yjs Client integrieren
- WebSocket Client für Presence (via Gateway)
- RxJS für State-Management

## Realtime Backend Setup (NestJS)
- NestJS Projekt erstellen
- WebSocket Gateway implementieren
- Yjs WebSocket Server integrieren
- Redis Presence Layer implementieren
- JWT-Validierung beim Handshake (Token vom Gateway/BFF)

## BFF Setup (NestJS empfohlen)
- Neues NestJS-Projekt als BFF
- Endpoints für UI-Aggregationen erstellen
- Caching (Redis) für heavy UI-Queries
- Auth-Forwarding / Token-Exchange implementieren

## Business Backend Setup (.NET 8)
- ASP.NET Web API Projekt erstellen
- Auth-Service (JWT/OIDC)
- Board-Service (CRUD)
- Template-Service
- Export-Service (PNG/PDF)

## Storage Setup
- PostgreSQL für Boards, Templates, Users
- Redis für Presence und Sessions
- MinIO für Uploads und Exports

## Infrastruktur Setup
- Docker-Compose mit allen Services (PoC)
- Traefik als Reverse Proxy / Gateway
- Kubernetes Manifeste für Produktion
- CI/CD mit GitHub Actions oder Azure DevOps

## Nächste Schritte (konkret)
- Gateway auswählen und Basis-Config (Traefik / Kong / APIM)
- BFF-Skeleton (NestJS) erstellen
- Realtime NestJS Gateway mit Yjs aufsetzen
- .NET Web API scaffolden und DB-Migrationen anlegen
- Infrastruktur: docker-compose.yml Vorlage erstellen

## Projektname
Gewählter Name: Elysion

## Hinweise
- Überlege Domain und GitHub-Repo: z. B. github.com/yourorg/elysion
- Prüfe verfügbare Social Handles und Domain-Verfügbarkeit
- Für PoC kann BFF + Realtime + Business in einer VM/Compose laufen; für Produktion trenne Services

## Fertig!
