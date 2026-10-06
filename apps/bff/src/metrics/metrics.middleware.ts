import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

/** Times every request, also the ones the auth guard refuses (an interceptor would not see those). */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    response.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // A request no route matched has no pattern: one label for all of them, not one per probed URL.
      const route = request.route?.path ? `${request.baseUrl}${request.route.path}` : 'unmatched';
      this.metrics.observe(request.method, route, response.statusCode, seconds);
    });
    next();
  }
}
