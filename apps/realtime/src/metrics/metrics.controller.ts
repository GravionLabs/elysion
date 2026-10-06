import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';

/**
 * Not routed at the edge (only `/yjs` is): a scraper reads it on the compose network, at `http://realtime:3000/metrics`.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
