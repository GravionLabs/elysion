import { Global, Module } from '@nestjs/common';
import { InternalTokenSigner } from '../auth/internal-token-signer.js';
import { loadConfig } from '../config/config.js';
import { DocumentStore } from './document-store.js';
import { HttpDocumentStore } from './http-document-store.js';

@Global()
@Module({
  providers: [
    {
      provide: DocumentStore,
      useFactory: () =>
        new HttpDocumentStore(new InternalTokenSigner(loadConfig(process.env).internalApiSecret)),
    },
  ],
  exports: [DocumentStore],
})
export class PersistenceModule {}
