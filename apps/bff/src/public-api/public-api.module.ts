import { Module } from '@nestjs/common';
import { PublicMeController } from './public-me.controller.js';

/** The public API under `/public/v1` (ADR 0033): its own Traefik router and its own guard rules (`@PublicApi()`). */
@Module({ controllers: [PublicMeController] })
export class PublicApiModule {}
