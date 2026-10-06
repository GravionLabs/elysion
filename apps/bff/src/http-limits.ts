import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The largest JSON body the BFF accepts. A template carries a whole scene, which the business backend limits to
 * 5 million characters; Express's default of 100 kB would refuse any real one before the backend sees it.
 */
export const MAX_JSON_BODY = '6mb';

export function applyHttpLimits(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: MAX_JSON_BODY });
}
