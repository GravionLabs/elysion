import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { MetricsService } from './metrics.service.js';

/**
 * Public like `/health`: a scraper carries no token. Not routed at the edge (only `/api` is), so it is reachable
 * on the compose network only, at `http://bff:3000/metrics`.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
