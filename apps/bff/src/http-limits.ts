import type { NestExpressApplication } from '@nestjs/platform-express';
import { PUBLIC_API_PATH, publicBodyErrors } from './public-api/problem-details.js';

/**
 * The largest JSON body the BFF accepts. A template carries a whole scene, which the business backend limits to
 * 5 million characters; Express's default of 100 kB would refuse any real one before the backend sees it.
 */
export const MAX_JSON_BODY = '6mb';

/** The public report endpoint reads its own body with a limit of 8 kB (csp-report.controller.ts): the 6 MB parser must not see it. */
const CSP_REPORT_PATH = '/api/csp-report';

/** The largest body of the public API (ADR 0033); the edge refuses a larger one first, this is the second lock. */
export const MAX_PUBLIC_JSON_BODY = '1mb';

type ParsedRequest = { url?: string; headers: { 'content-type'?: string } };

const pathOf = (req: ParsedRequest) => (req.url ?? '').split('?')[0];

/** Whether the global JSON parser reads this request: an `application/json` body anywhere but the public report endpoint and the public API. */
export function isReadAsJson(req: ParsedRequest): boolean {
  const path = pathOf(req);
  return (
    !path.startsWith(CSP_REPORT_PATH) &&
    !path.startsWith(PUBLIC_API_PATH) &&
    /^application\/json\b/i.test(req.headers['content-type'] ?? '')
  );
}

/** Whether the public API's parser (1 MiB) reads this request: a JSON body (`application/json` or `+json`) under `/public/`. */
export function isReadAsPublicJson(req: ParsedRequest): boolean {
  return (
    pathOf(req).startsWith(PUBLIC_API_PATH) &&
    /^application\/([\w.-]+\+)?json\b/i.test(req.headers['content-type'] ?? '')
  );
}

export function applyHttpLimits(app: NestExpressApplication): void {
  app.disable('x-powered-by'); // no `X-Powered-By: Express` banner (#781)
  app.useBodyParser('json', { limit: MAX_JSON_BODY, type: isReadAsJson });
  app.useBodyParser('json', { limit: MAX_PUBLIC_JSON_BODY, type: isReadAsPublicJson });
  // A malformed or too large body of a public route is answered as problem details, like the route's other errors.
  app.use(publicBodyErrors);
}
