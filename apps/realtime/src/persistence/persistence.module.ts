import { Global, Module } from '@nestjs/common';
import { DocumentStore } from './document-store.js';
import { HttpDocumentStore } from './http-document-store.js';

@Global()
@Module({
  providers: [{ provide: DocumentStore, useFactory: () => new HttpDocumentStore() }],
  exports: [DocumentStore],
})
export class PersistenceModule {}
