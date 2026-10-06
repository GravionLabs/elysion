import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient, Template, TemplateSummary } from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const templateId = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/**
 * The template catalog: the list without scenes, one template with its scene (an `.excalidraw` file as text), and
 * the user's own templates: saved with a name, a description and a scene, deleted by id. The rules (lengths, what
 * a scene is, whose templates are visible, that built-in ones stay) belong to the business backend, which answers
 * 400, 403 and 404.
 */
@Controller('api/templates')
export class TemplatesController {
  constructor(private readonly backend: BusinessBackendClient) {}

  @Get()
  list(@AccessToken() token: string): Promise<TemplateSummary[]> {
    return this.backend.listTemplates(token);
  }

  @Get(':id')
  get(@AccessToken() token: string, @Param('id', templateId) id: string): Promise<Template> {
    return this.backend.getTemplate(token, id);
  }

  @Post()
  create(@AccessToken() token: string, @Body() body: unknown): Promise<Template> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('A template needs a name and a scene.');
    }
    const { name, description, scene } = body as Record<string, unknown>;
    return this.backend.createTemplate(token, { name, description, scene });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@AccessToken() token: string, @Param('id', templateId) id: string): Promise<void> {
    await this.backend.deleteTemplate(token, id);
  }
}
