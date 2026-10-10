import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The largest JSON body the BFF accepts. A template carries a whole scene, which the business backend limits to
 * 5 million characters; Express's default of 100 kB would refuse any real one before the backend sees it.
 */
export const MAX_JSON_BODY = '6mb';

/** The public report endpoint reads its own body with a limit of 8 kB (csp-report.controller.ts): the 6 MB parser must not see it. */
const CSP_REPORT_PATH = '/api/csp-report';

/** Whether the global JSON parser reads this request: an `application/json` body anywhere but the public report endpoint. */
export function isReadAsJson(req: { url?: string; headers: { 'content-type'?: string } }): boolean {
  return (
    !(req.url ?? '').split('?')[0].startsWith(CSP_REPORT_PATH) &&
    /^application\/json\b/i.test(req.headers['content-type'] ?? '')
  );
}

export function applyHttpLimits(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: MAX_JSON_BODY, type: isReadAsJson });
}
