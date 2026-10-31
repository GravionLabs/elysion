import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import {
  BusinessBackendClient,
  type CreatedWebhook,
  type Webhook,
  type WebhookDelivery,
} from './business-backend.client.js';
import { uuidPipe as uuid, webhookInput, webhookPatch } from './request-parsing.js';

/**
 * A board's webhooks for the shell's "Webhooks" section (ADR 0033, #853): owners only, which the backend decides (403 for a lower
 * role, 404 for none). The secret is in the answer to the creation and nowhere else.
 */
@Controller('api/boards/:id/webhooks')
export class BoardWebhooksController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string, @Param('id', uuid) id: string): Promise<Webhook[]> {
    return this.backend.listWebhooks(token, id);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<CreatedWebhook> {
    return this.backend.createWebhook(token, id, webhookInput(body));
  }

  @Get(':webhookId')
  get(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<Webhook> {
    return this.backend.getWebhook(token, id, webhookId);
  }

  @Patch(':webhookId')
  update(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Body() body: unknown,
  ): Promise<Webhook> {
    return this.backend.updateWebhook(token, id, webhookId, webhookPatch(body));
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<void> {
    return this.backend.deleteWebhook(token, id, webhookId);
  }

  @Post(':webhookId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  test(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery> {
    return this.backend.testWebhook(token, id, webhookId);
  }

  @Get(':webhookId/deliveries')
  deliveries(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery[]> {
    return this.backend.listWebhookDeliveries(token, id, webhookId);
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliver')
  @HttpCode(HttpStatus.ACCEPTED)
  redeliver(
    @AccessToken() token: string,
    @Param('id', uuid) id: string,
    @Param('webhookId', uuid) webhookId: string,
    @Param('deliveryId', uuid) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return this.backend.redeliverWebhook(token, id, webhookId, deliveryId);
  }
}

/** The instance-wide webhooks of the admin pages (ADR 0027, #853): the events of every board, for administrators (403 otherwise). */
@Controller('api/admin/webhooks')
export class AdminWebhooksController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string): Promise<Webhook[]> {
    return this.backend.listWebhooks(token, null);
  }

  @Post()
  create(@AccessToken() token: string, @Body() body: unknown): Promise<CreatedWebhook> {
    return this.backend.createWebhook(token, null, webhookInput(body));
  }

  @Get(':webhookId')
  get(@AccessToken() token: string, @Param('webhookId', uuid) webhookId: string): Promise<Webhook> {
    return this.backend.getWebhook(token, null, webhookId);
  }

  @Patch(':webhookId')
  update(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
    @Body() body: unknown,
  ): Promise<Webhook> {
    return this.backend.updateWebhook(token, null, webhookId, webhookPatch(body));
  }

  @Delete(':webhookId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@AccessToken() token: string, @Param('webhookId', uuid) webhookId: string): Promise<void> {
    return this.backend.deleteWebhook(token, null, webhookId);
  }

  @Post(':webhookId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  test(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery> {
    return this.backend.testWebhook(token, null, webhookId);
  }

  @Get(':webhookId/deliveries')
  deliveries(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
  ): Promise<WebhookDelivery[]> {
    return this.backend.listWebhookDeliveries(token, null, webhookId);
  }

  @Post(':webhookId/deliveries/:deliveryId/redeliver')
  @HttpCode(HttpStatus.ACCEPTED)
  redeliver(
    @AccessToken() token: string,
    @Param('webhookId', uuid) webhookId: string,
    @Param('deliveryId', uuid) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return this.backend.redeliverWebhook(token, null, webhookId, deliveryId);
  }
}
