import { Global, Module } from '@nestjs/common';
import { loadConfig } from '../config/config.js';
import { WsTokenVerifier } from './ws-token-verifier.js';

/** The WS token check for the `/yjs` handshake. The secret comes from `WS_TOKEN_SECRET`; without it the app does not start. */
@Global()
@Module({
  providers: [
    {
      provide: WsTokenVerifier,
      useFactory: () => new WsTokenVerifier(loadConfig(process.env).wsTokenSecret),
    },
  ],
  exports: [WsTokenVerifier],
})
export class AuthModule {}
