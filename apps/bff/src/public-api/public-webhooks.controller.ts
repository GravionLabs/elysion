import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessToken } from '../auth/access-token.decorator.js';
import { PublicApi } from '../auth/public-api.js';
import {
  BusinessBackendClient,
  type Webhook as BackendWebhook,
  type WebhookDelivery as BackendDelivery,
} from '../boards/business-backend.client.js';
import { uuidPipe as uuid, webhookInput, webhookPatch } from '../boards/request-parsing.js';
import {
  CreatedWebhook,
  CreateWebhook,
  EXAMPLE_IDS,
  UpdateWebhook,
  Webhook,
  WebhookDelivery,
  WebhookDeliveryPage,
  WebhookPage,
} from './dto.js';
import { type Page, paginate, timeKey } from './pagination.js';
import { PUBLIC_PREFIX } from './public-boards.controller.js';
import { PublicRoute } from './public-route.js';

const WEBHOOK_EXAMPLE = {
  id: EXAMPLE_IDS.WEBHOOK_ID,
  boardId: EXAMPLE_IDS.BOARD_ID,
  url: 'https://hooks.example.com/elysion',
  events: ['board.renamed', 'member.added'],
  enabled: true,
  disabledAt: null,
  disabledReason: null,
  createdAt: '2026-10-31T09:15:00Z',
  secretPrefix: 'whsec_k3Tq',
};

const DELIVERY_EXAMPLE = {
  id: EXAMPLE_IDS.DELIVERY_ID,
  eventId: EXAMPLE_IDS.EVENT_ID,
  eventType: 'board.renamed',
  status: 'succeeded',
  attempts: 1,
  responseStatus: 200,
  durationMs: 143,
  error: null,
  createdAt: '2026-10-31T09:20:00Z',
  lastAttemptAt: '2026-10-31T09:20:01Z',
  nextAttemptAt: null,
};

const PENDING_EXAMPLE = {
  ...DELIVERY_EXAMPLE,
  eventType: 'webhook.test',
  status: 'pending',
  attempts: 0,
  responseStatus: null,
  durationMs: null,
  lastAttemptAt: null,
  nextAttemptAt: '2026-10-31T09:20:00Z',
};

const SCOPE = 'webhooks:write';
const SIGNING =
  'Every delivery is a signed `POST` (see docs/webhooks.md): `Elysion-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.';

const toWebhook = (webhook: BackendWebhook): Webhook => ({
  id: webhook.id,
  boardId: webhook.boardId ?? null,
  url: webhook.url,
  events: webhook.events,
  enabled: webhook.enabled,
  disabledAt: webhook.disabledAt ?? null,
  disabledReason: webhook.disabledReason ?? null,
  createdAt: webhook.createdAt,
  secretPrefix: webhook.secretPrefix,
});

const toDelivery = (delivery: BackendDelivery): WebhookDelivery => ({
  id: delivery.id,
  eventId: delivery.eventId,
  eventType: delivery.eventType,
  status: delivery.status,
  attempts: delivery.attempts,
  responseStatus: delivery.responseStatus ?? null,
  durationMs: delivery.durationMs ?? null,
  error: delivery.error ?? null,
  createdAt: delivery.createdAt,
  lastAttemptAt: delivery.lastAttemptAt ?? null,
  nextAttemptAt: delivery.nextAttemptAt ?? null,
});

/** Oldest first, by id within the same time: the order the owners made them in. */
const webhooksOrder = {
  key: (webhook: Webhook) => [timeKey(webhook.createdAt), webhook.id],
  directions: ['asc', 'asc'] as Array<'asc' | 'desc'>,
};

/** Newest first, as the shell shows them. */
const deliveriesOrder = {
  key: (delivery: WebhookDelivery) => [timeKey(delivery.createdAt), delivery.id],
  directions: ['desc', 'asc'] as Array<'asc' | 'desc'>,
};

const LIST_QUERIES = (what: string) => [
  ApiQuery({
    name: 'cursor',
    required: false,
    description: 'The `next` of the page before.',
    schema: { type: 'string' },
  }),
  ApiQuery({
    name: 'limit',
    required: false,
    description: `${what} per page, 1 to 200.`,
    schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  }),
];

type Owner = 'board' | 'instance';

/** Who may use the routes, for their descriptions. */
const WHO: Record<Owner, string> = {
  board: 'Owners of the board only.',
  instance:
    'Administrators only (a person signed in with the realm role of an administrator, with their own Keycloak token).',
};

const boardParam = ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.BOARD_ID });
const webhookParam = ApiParam({
  name: 'webhookId',
  format: 'uuid',
  example: EXAMPLE_IDS.WEBHOOK_ID,
});
const deliveryParam = ApiParam({
  name: 'deliveryId',
  format: 'uuid',
  example: EXAMPLE_IDS.DELIVERY_ID,
});

/** The OpenAPI description of each route, for a board's webhooks or the instance-wide ones. */
const docs = (owner: Owner) => {
  const of = owner === 'board' ? 'of a board' : 'of every board';
  const params = owner === 'board' ? [boardParam] : [];
  const notFound = owner === 'board' ? [404] : [];
  return {
    list: [
      PublicRoute({
        scope: SCOPE,
        summary: `List the webhooks ${of}`,
        description: `${WHO[owner]} Oldest first; never the secret.`,
        status: 200,
        type: WebhookPage,
        example: {
          items: [owner === 'board' ? WEBHOOK_EXAMPLE : { ...WEBHOOK_EXAMPLE, boardId: null }],
          next: null,
        },
        errors: [400, ...notFound],
      }),
      ...params,
      ...LIST_QUERIES('Webhooks'),
    ],
    create: [
      PublicRoute({
        scope: SCOPE,
        summary: `Register a webhook ${of}`,
        description: `${WHO[owner]} An \`https\` URL on a public address and the events to receive (none: all). The answer is the one time the \`secret\` is shown. ${SIGNING}`,
        status: 201,
        type: CreatedWebhook,
        example: {
          ...WEBHOOK_EXAMPLE,
          ...(owner === 'board' ? {} : { boardId: null }),
          secret: 'whsec_k3TqW8xZ1mN5pR2vY7bC4dF9gH6jL0sA3eU8iO1tQ5w',
        },
        headers: {
          Location: { description: 'The address of the webhook.', schema: { type: 'string' } },
        },
        errors: [400, ...notFound, 409, 413],
      }),
      ...params,
      ApiBody({
        type: CreateWebhook,
        examples: {
          some: {
            value: { url: 'https://hooks.example.com/elysion', events: ['board.renamed'] },
          },
          all: { value: { url: 'https://hooks.example.com/elysion' } },
        },
      }),
    ],
    get: [
      PublicRoute({
        scope: SCOPE,
        summary: `Read a webhook ${of}`,
        description: `${WHO[owner]} Never the secret; \`disabledReason\` says why it is off.`,
        status: 200,
        type: Webhook,
        example: WEBHOOK_EXAMPLE,
        errors: [404],
      }),
      ...params,
      webhookParam,
    ],
    update: [
      PublicRoute({
        scope: SCOPE,
        summary: `Change a webhook ${of}`,
        description: `${WHO[owner]} Its URL, its events, or \`enabled\` (\`false\` switches it off and gives up the deliveries that still wait; \`true\` switches it on again, also one that was switched off after a day of failures).`,
        status: 200,
        type: Webhook,
        example: WEBHOOK_EXAMPLE,
        errors: [400, 404, 413],
      }),
      ...params,
      webhookParam,
      ApiBody({
        type: UpdateWebhook,
        examples: { enable: { value: { enabled: true } } },
      }),
    ],
    remove: [
      PublicRoute({
        scope: SCOPE,
        summary: `Delete a webhook ${of}`,
        description: `${WHO[owner]} With its deliveries.`,
        status: 204,
        errors: [404],
      }),
      ...params,
      webhookParam,
    ],
    test: [
      PublicRoute({
        scope: SCOPE,
        summary: 'Send a test event',
        description: `${WHO[owner]} Puts a \`webhook.test\` event for this webhook in the outbox; it is sent within seconds, signed like every other. \`409\` while the webhook is switched off.`,
        status: 202,
        type: WebhookDelivery,
        example: PENDING_EXAMPLE,
        errors: [404, 409],
      }),
      ...params,
      webhookParam,
    ],
    deliveries: [
      PublicRoute({
        scope: SCOPE,
        summary: 'List the last deliveries of a webhook',
        description: `${WHO[owner]} The last 50, newest first, with their status and duration; never the body.`,
        status: 200,
        type: WebhookDeliveryPage,
        example: { items: [DELIVERY_EXAMPLE], next: null },
        errors: [400, 404],
      }),
      ...params,
      webhookParam,
      ...LIST_QUERIES('Deliveries'),
    ],
    redeliver: [
      PublicRoute({
        scope: SCOPE,
        summary: 'Send a delivery again',
        description: `${WHO[owner]} The same event (same \`eventId\` and body) as a new delivery; \`409\` while the delivery is still being sent or the webhook is switched off.`,
        status: 202,
        type: WebhookDelivery,
        example: { ...PENDING_EXAMPLE, eventType: 'board.renamed' },
        errors: [404, 409],
      }),
      ...params,
      webhookParam,
      deliveryParam,
    ],
  };
};

const BOARD = docs('board');
const INSTANCE = docs('instance');

/**
 * A board's webhooks on the public API (ADR 0033, #853): the owners register, change and delete them, send a test event, list the
 * deliveries and send one again; scope `webhooks:write`. Passed on to the business backend with the caller's token.
 */
@PublicApi()
@ApiTags('Webhooks')
@Controller('public/v1/boards/:id/webhooks')
export class PublicBoardWebhooksController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @applyDecorators(...BOARD.list)
  async list(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<Webhook>> {
    return paginate((await this.backend.listWebhooks(token, id)).map(toWebhook), webhooksOrder, {
      cursor,
      limit,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @applyDecorators(...BOARD.create)
  async create(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreatedWebhook> {
    const created = await this.backend.createWebhook(token, id, webhookInput(body));
    response.setHeader('Location', `${PUBLIC_PREFIX}/boards/${id}/webhooks/${created.id}`);
    return { ...toWebhook(created), secret: created.secret };
  }

  @Get(':webhookId')
  @applyDecorators(...BOARD.get)
  async get(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<Webhook> {
    return toWebhook(await this.backend.getWebhook(token, id, webhookId));
  }

  @Patch(':webhookId')
  @applyDecorators(...BOARD.update)
  async update(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Body() body: unknown,
  ): Promise<Webhook> {
    return toWebhook(await this.backend.updateWebhook(token, id, webhookId, webhookPatch(body)));
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @applyDecorators(...BOARD.remove)
  async remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<void> {
    await this.backend.deleteWebhook(token, id, webhookId);
  }

  @Post(':webhookId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @applyDecorators(...BOARD.test)
  async test(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery> {
    return toDelivery(await this.backend.testWebhook(token, id, webhookId));
  }

  @Get(':webhookId/deliveries')
  @applyDecorators(...BOARD.deliveries)
  async deliveries(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<WebhookDelivery>> {
    return paginate(
      (await this.backend.listWebhookDeliveries(token, id, webhookId)).map(toDelivery),
      deliveriesOrder,
      { cursor, limit },
    );
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliver')
  @HttpCode(HttpStatus.ACCEPTED)
  @applyDecorators(...BOARD.redeliver)
  async redeliver(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Param('deliveryId', uuid) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return toDelivery(await this.backend.redeliverWebhook(token, id, webhookId, deliveryId));
  }
}

/**
 * The instance-wide webhooks on the public API (#853): the events of every board, for administrators. A personal access token never
 * carries the administrator's role, so these answer `403` to one; an administrator calls them with their own Keycloak token.
 */
@PublicApi()
@ApiTags('Webhooks')
@Controller('public/v1/webhooks')
export class PublicInstanceWebhooksController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  @applyDecorators(...INSTANCE.list)
  async list(
    @AccessToken() token: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<Webhook>> {
    return paginate((await this.backend.listWebhooks(token, null)).map(toWebhook), webhooksOrder, {
      cursor,
      limit,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @applyDecorators(...INSTANCE.create)
  async create(
    @AccessToken() token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreatedWebhook> {
    const created = await this.backend.createWebhook(token, null, webhookInput(body));
    response.setHeader('Location', `${PUBLIC_PREFIX}/webhooks/${created.id}`);
    return { ...toWebhook(created), secret: created.secret };
  }

  @Get(':webhookId')
  @applyDecorators(...INSTANCE.get)
  async get(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<Webhook> {
    return toWebhook(await this.backend.getWebhook(token, null, webhookId));
  }

  @Patch(':webhookId')
  @applyDecorators(...INSTANCE.update)
  async update(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
    @Body() body: unknown,
  ): Promise<Webhook> {
    return toWebhook(await this.backend.updateWebhook(token, null, webhookId, webhookPatch(body)));
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @applyDecorators(...INSTANCE.remove)
  async remove(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<void> {
    await this.backend.deleteWebhook(token, null, webhookId);
  }

  @Post(':webhookId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @applyDecorators(...INSTANCE.test)
  async test(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery> {
    return toDelivery(await this.backend.testWebhook(token, null, webhookId));
  }

  @Get(':webhookId/deliveries')
  @applyDecorators(...INSTANCE.deliveries)
  async deliveries(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
    @Query('cursor') cursor?: unknown,
    @Query('limit') limit?: unknown,
  ): Promise<Page<WebhookDelivery>> {
    return paginate(
      (await this.backend.listWebhookDeliveries(token, null, webhookId)).map(toDelivery),
      deliveriesOrder,
      { cursor, limit },
    );
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliver')
  @HttpCode(HttpStatus.ACCEPTED)
  @applyDecorators(...INSTANCE.redeliver)
  async redeliver(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
    @Param('deliveryId', uuid) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return toDelivery(await this.backend.redeliverWebhook(token, null, webhookId, deliveryId));
  }
}
