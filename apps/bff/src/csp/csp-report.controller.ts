import { Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';

/** The largest report body read; a violation report is a few hundred bytes. */
export const MAX_CSP_REPORT_BYTES = 8 * 1024;

/** The content types a browser reports with. */
const REPORT_CONTENT_TYPES = new Set(['application/csp-report', 'application/reports+json']);

/** What a report says, reduced to what the log line carries: nothing of the page's own URL, no query. */
export interface CspViolation {
  directive: string;
  blocked: string;
}

/** A blocked URL without its query and fragment (they can hold a token), cut to a sane length. */
function cleanUri(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    return 'unknown';
  }
  // `inline`, `eval`, `data` and the like are not URLs: keep the keyword.
  const [withoutFragment] = value.split('#');
  const [withoutQuery] = withoutFragment.split('?');
  return withoutQuery.slice(0, 200);
}

function cleanDirective(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 80) : 'unknown';
}

/**
 * The violations in a body, in either format a browser sends: the legacy `report-uri` object
 * (`{"csp-report": {...}}`, `application/csp-report`) and the Reporting API's list
 * (`[{"type": "csp-violation", "body": {...}}]`, `application/reports+json`). Anything else gives none.
 */
export function violationsOf(body: unknown): CspViolation[] {
  if (Array.isArray(body)) {
    return body.flatMap((entry: unknown) => {
      const report = entry as { type?: unknown; body?: Record<string, unknown> } | null;
      if (report?.type !== 'csp-violation' || !report.body) {
        return [];
      }
      return [
        {
          directive: cleanDirective(report.body['effectiveDirective']),
          blocked: cleanUri(report.body['blockedURL']),
        },
      ];
    });
  }
  const legacy = (body as { 'csp-report'?: Record<string, unknown> } | null)?.['csp-report'];
  if (legacy && typeof legacy === 'object') {
    return [
      {
        directive: cleanDirective(legacy['effective-directive'] ?? legacy['violated-directive']),
        blocked: cleanUri(legacy['blocked-uri']),
      },
    ];
  }
  return [];
}

/** Reads the body up to the limit; more than that gives `null` (the rest is read and thrown away, so the answer still reaches the sender). */
function readBody(req: Request): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_CSP_REPORT_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * Where the browser reports what the frontend's Content-Security-Policy blocked (or, in report-only mode, would
 * block). Public: a browser sends a report without a token. The edge rate limits it (`docker-compose.yml`) and
 * the body is limited here. Each violation is logged at warn with its directive and blocked URI, nothing else.
 */
@Public()
@Controller('api/csp-report')
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  @Post()
  @HttpCode(204)
  async report(@Req() req: Request): Promise<void> {
    // Only what a browser sends: `report-uri` (application/csp-report) and the Reporting API (application/reports+json).
    // Anything else, application/json included, is not read. The global JSON parser skips this path (http-limits.ts), so
    // the 8 kB limit of readBody is the only limit that applies.
    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!REPORT_CONTENT_TYPES.has(contentType)) {
      return;
    }
    const text = await readBody(req);
    if (text === null) {
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    // One line per request, so that a request cannot multiply what the rate limit allows: the first violation, and how
    // many more the report held.
    const [first, ...more] = violationsOf(body).slice(0, 10);
    if (first) {
      this.logger.warn(
        `CSP violation: ${first.directive} blocked ${first.blocked}${more.length > 0 ? ` (+${more.length} more in this report)` : ''}`,
        'CspReport',
      );
    }
  }
}
