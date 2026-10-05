import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';

// Container health checks carry no token.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
