# ADR 0006: Shared local infrastructure from local-infra

- Status: accepted
- Date: 2026-10-04
- Issues: #149, #157, #158, #159, #160
- Pull requests: #153, #161

## Context

The developer machine already runs a shared stack in `../local-infra`: Valkey on 6379, RabbitMQ on
5672/15672 and Portainer on 9000, all bound to 127.0.0.1. Its README makes the rule explicit: these run
once per machine and are shared by all local projects instead of each bringing its own copy. Elysion's
compose file still defined its own `redis`, which collided on port 6379, and its RustFS object store
asked for port 9000, which Portainer owns.

## Decision

1. **Elysion's compose file does not define Valkey, RabbitMQ or Portainer.** It defines only what is
   Elysion's own: Traefik, Postgres, RustFS. Apps on the host use `localhost:6379` (`REDIS_URL` overrides
   it); apps running as containers join the external `local-infra` network and use `valkey:6379`.
2. **Everything Elysion stores in Valkey is namespaced with `elysion:`**, following local-infra's
   multi-tenancy rule (one key prefix per project). Realtime's channels are
   `elysion:presence:<boardId>` and its state hashes `elysion:presence:state:<boardId>`.
3. **RustFS' host ports are 9100 (S3) and 9101 (console)**, overridable through `infra/docker/.env`.
4. **The full-stack launch checks local-infra first.** A VS Code task fails with a hint when the Valkey
   container is not running, before `infra: up` starts Elysion's own services.

## Consequences

- Elysion needs local-infra running; a fresh clone alone does not give a working backend. The README and
  `AGENTS.md` say so.
- Other projects use the same Valkey. Pub/sub channels are not isolated by database number, so the
  prefix is the only protection; new code must prefix every key and channel.
- The realtime end-to-end tests write into the shared instance. They use prefixed, per-run keys; presence hashes expire a day after their last write, so the tests leave nothing behind for long.
- Valkey is Redis-protocol compatible, not identical to Redis 7. `ioredis` works against it; features
  Elysion adds later should be checked against Valkey, not assumed.
- RabbitMQ is available if Elysion needs messaging, with a vhost of its own as local-infra prescribes.
