import { Controller, Get, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { AccessToken } from '../auth/access-token.decorator.js';
import { BusinessBackendClient, Template, TemplateSummary } from './business-backend.client.js';

// An id that is not a UUID cannot exist, so it is a 404 without asking the backend.
const templateId = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** The template catalog: the list without scenes, one template with its scene (an `.excalidraw` file as text). */
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
}
