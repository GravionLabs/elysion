import { Controller, Get } from '@nestjs/common';

/** For container and Kubernetes probes: the process is up and serving HTTP. Not routed at the edge. */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
