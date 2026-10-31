# Webhooks

Elysion tells your service when something happens on a board, instead of your service asking again and again: it sends a signed
`POST` with a small JSON body to a URL you register ([ADR 0033](adr/0033-public-api-tokens-and-webhooks.md), #853). This page lists
the events and their payloads, says how delivery and retries work, and shows how to check a signature.

## Registering a webhook

- **For one board:** an owner of the board opens **Share** and the section **Webhooks**, or calls the public API with a token that has
  the scope `webhooks:write`: `POST /public/v1/boards/{id}/webhooks` ([api.md](api.md), the
  [reference](api/reference.md)).
- **For every board:** an administrator opens **Administration → Webhooks** (`/admin/webhooks`), or calls
  `POST /public/v1/webhooks` with their own Keycloak access token (a personal access token never carries the administrator's role, so
  it gets `403` there). Such a webhook hears about every board of the instance, also boards made later.

A webhook has a URL, the events it wants (none ticked: all of them) and a **secret**. The secret is shown **once**, in the answer to
the registration: copy it into your receiver then. Elysion keeps it to sign the deliveries, never shows it again (the lists show its
first ten characters, `whsec_` and four more, to tell webhooks apart), and never writes it to a log. To change the secret, delete the
webhook and register it again.

A board has at most ten webhooks, and so has the instance. Only `https` URLs on a public address are accepted (see
[Security](#security)).

## The payload

Every delivery is a JSON object with the same fields:

```json
{
  "id": "0192f7a6-4071-73a8-e4c6-9b1d3e5f7086",
  "type": "board.renamed",
  "occurredAt": "2026-10-31T09:20:00+00:00",
  "boardId": "0192f7a4-6f0e-7c3b-9d51-2a4b6c8d0e1f",
  "actorId": "0192f7a4-81c2-7e53-9f71-4c6d8e0f2a31",
  "data": { "name": "Sprint 42 retro", "previousName": "Sprint 42" }
}
```

| Field        | Meaning                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | The event's id. A retry and a "Send again" carry the same id: use it to ignore an event you have handled already.                                                           |
| `type`       | One of the events below.                                                                                                                                                    |
| `occurredAt` | When it happened (ISO 8601, UTC).                                                                                                                                           |
| `boardId`    | The board it is about.                                                                                                                                                      |
| `actorId`    | The Elysion user id of the person (or integration) who did it; `null` when nobody did (a content change saved by the realtime service). `GET /public/v1/me` shows your own. |
| `data`       | What changed: names, roles, ids. **Never the content of the board**: read it with `GET /public/v1/boards/{id}/elements` if you need it.                                     |

The request also carries the headers `Content-Type: application/json`, `User-Agent: Elysion-Webhooks/1`, `Elysion-Event` (the type),
`Elysion-Event-Id` (the event's id), `Elysion-Delivery` (the id of this delivery: the same for its retries, a new one for a "Send again") and
`Elysion-Signature`.

## Events

| Event                   | When                                                                                                                                         | `data`                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `board.created`         | A board was made: new, a duplicate, or a version opened as a new board. Only instance-wide webhooks hear it (the board had none before).     | `name`; `duplicatedFrom` (a board id) for a duplicate; `openedFrom: { boardId, snapshotId }` for a version |
| `board.renamed`         | The board's name changed (renaming to the same name sends nothing).                                                                          | `name`, `previousName`                                                                                     |
| `board.deleted`         | The board was deleted. Its own webhooks still get this one; they are removed after it was delivered (or given up).                           | `name`                                                                                                     |
| `board.content.changed` | Somebody changed what is on the board. Sent when the realtime service saves the board, **at most once a minute per board**.                  | `version`: the version of the stored state                                                                 |
| `member.added`          | A person got a role on the board: added in the Share dialog or through the API, or joined with an invitation link (then they are the actor). | `userId`, `role`                                                                                           |
| `member.role_changed`   | A member's role changed (also when an invitation link raises it).                                                                            | `userId`, `previousRole`, `role`                                                                           |
| `member.removed`        | A member was removed.                                                                                                                        | `userId`, `role` (the one they had)                                                                        |
| `snapshot.created`      | A person saved a version ("Save version", or `POST /public/v1/boards/{id}/snapshots`).                                                       | `snapshotId`, `name` (or `null`)                                                                           |
| `webhook.test`          | Somebody pressed **Send test event** (or called `POST .../webhooks/{webhookId}/test`). Only that webhook gets it; nobody subscribes to it.   | `webhookId`                                                                                                |

Roles are `Owner`, `Editor` and `Viewer`. Members of a **room** are not board events: a webhook is per board (webhooks per room are not in
v1).

**Not sent:**

- **Automatic versions and "Before restore" versions** do not send `snapshot.created`: only a version a person saves does. The
  automatic ones are Elysion's own history (one an hour while a board is edited, kept 30 days), and their changes are already reported
  by `board.content.changed`; a "Before restore" version is a step of a restore, not a person's decision to keep a version. They have
  no actor, which every other event has.
- **`comment.created`**, which [ADR 0033](adr/0033-public-api-tokens-and-webhooks.md) lists, is not in v1: the backend keeps a board as a
  Yjs state it does not decode, so it cannot tell a comment from any other change in a save. A comment is a `board.content.changed`.
- A **compaction** of a board's stored state (ADR 0026) changes nothing on the board and sends nothing.

## Delivery and retries

An event is written to an **outbox** in Elysion's database in the same transaction as the change: no event for a change that failed, and
no change without its event. A worker in the business backend sends it within a few seconds, so a slow receiver never slows Elysion down.

- **Success** is any `2xx` answer within **10 seconds**. Answer quickly and do the work afterwards.
- A **redirect** (`3xx`) is not followed: it counts as a failure. Register the final URL.
- **Retries:** a failed delivery is sent again after 30 seconds, then after 1, 2, 4, … minutes, at most an hour apart, for **24
  hours** from the event. Then it is given up (`failed`).
- **Switched off:** when no delivery to a webhook has succeeded for **24 hours**, Elysion switches the webhook off, gives up what still
  waits for it, and shows the owners why (the reason with the last error, in the Webhooks section and as `disabledReason` in the API).
  Switch it on again when the receiver works; nothing is sent while it is off.
- Events can arrive **more than once** (a retry after an answer that got lost, a "Send again") and **out of order** (a retry of an
  older event after a newer one). Use the event `id` to ignore repeats, and `occurredAt` to order them.
- The **last 50 deliveries** of each webhook are kept with their status, attempts, the HTTP status of the last answer, how long it
  took and the error, and each one can be **sent again** (the same event, as a new delivery). The body of your answer is not read or
  kept.

## Checking the signature

Every delivery has a header

```text
Elysion-Signature: t=1761902400,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

where `t` is the time it was sent (Unix seconds) and `v1` the HMAC-SHA256, in lower-case hex, of `<t>.<body>` (the timestamp, a dot and
the raw body, exactly as received), keyed with the webhook's secret (its UTF-8 bytes, `whsec_` included). To check it:

1. Read the **raw** body; do not parse and serialize it again first.
2. Compute the HMAC of `t + "." + body` with your secret and compare it with `v1` in **constant time**.
3. Refuse a `t` more than **five minutes** from your clock, so a recorded request cannot be replayed later.

Each attempt is signed again with its own `t`, so a retry passes the check too.

### Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const SECRET = process.env.ELYSION_WEBHOOK_SECRET; // whsec_...
const TOLERANCE_SECONDS = 5 * 60;

function verify(header, body) {
  const parts = Object.fromEntries(
    (header ?? '').split(',').map((part) => part.split('=', 2).map((s) => s.trim())),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || typeof parts.v1 !== 'string') return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  const given = Buffer.from(parts.v1);
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
}

const app = express();
app.post('/elysion', express.raw({ type: 'application/json' }), (req, res) => {
  const body = req.body.toString('utf8');
  if (!verify(req.get('Elysion-Signature'), body)) return res.sendStatus(401);
  const event = JSON.parse(body);
  res.sendStatus(204); // answer first, then work
  console.log(event.type, event.boardId, event.data);
});
app.listen(8080);
```

### C# (ASP.NET Core)

```csharp
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var secret = builder.Configuration["ELYSION_WEBHOOK_SECRET"]!; // whsec_...

app.MapPost("/elysion", async (HttpRequest request) =>
{
    using var reader = new StreamReader(request.Body, Encoding.UTF8);
    var body = await reader.ReadToEndAsync();
    if (!Verify(secret, request.Headers["Elysion-Signature"].ToString(), body, DateTimeOffset.UtcNow))
    {
        return Results.Unauthorized();
    }

    using var json = JsonDocument.Parse(body);
    var type = json.RootElement.GetProperty("type").GetString();
    // Answer quickly; hand the event to a queue for the real work.
    return Results.NoContent();
});

app.Run();

static bool Verify(string secret, string header, string body, DateTimeOffset now)
{
    var parts = header.Split(',')
        .Select(part => part.Split('=', 2))
        .Where(pair => pair.Length == 2)
        .ToDictionary(pair => pair[0].Trim(), pair => pair[1].Trim());
    if (!parts.TryGetValue("t", out var t) || !parts.TryGetValue("v1", out var v1)
        || !long.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
        || Math.Abs(now.ToUnixTimeSeconds() - seconds) > 300)
    {
        return false;
    }

    var mac = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{t}.{body}"));
    return CryptographicOperations.FixedTimeEquals(
        Encoding.ASCII.GetBytes(Convert.ToHexStringLower(mac)),
        Encoding.ASCII.GetBytes(v1));
}
```

To try a receiver, register it, press **Send test event** and look at the deliveries: the status, the HTTP status and the error say
what happened.

## Security

- **`https` only**, to a host on the **public internet.** Elysion resolves the host itself when it sends, and refuses to connect when
  no address is public: private (`10/8`, `172.16/12`, `192.168/16`), loopback, link-local (the cloud metadata address `169.254.169.254`
  among them), shared (`100.64/10`), unique-local (`fc00::/7`), multicast and reserved ranges, IPv6 included, and IPv4 addresses inside
  IPv6 ones (`::ffff:10.0.0.1`). It connects to the address it checked, so a name that resolves to something else a moment later
  (DNS rebinding) changes nothing. A URL with a user name or password is refused; no proxy is used; redirects are not followed.
- The URL's path and query are never logged (only the host), and neither are the secret, the headers or the body. The audit log
  records who added or deleted a webhook, with its host (`webhook.created`, `webhook.deleted`).
- Your receiver should check the signature and the time on every request, and treat the payload as a hint: fetch what you need through
  the API with your own token.

**For development only**, two settings of the business backend relax this: `WEBHOOKS_ALLOW_HTTP=true` accepts plain `http` URLs, and
`WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true` lets the worker connect to private and loopback addresses (a receiver on your machine). Never set
them in production: they let anybody who may register a webhook make the backend send requests into its own network.
