import type { DocumentRelay } from '../document/document-relay.js';

/** A relay that connects to nobody; for tests of code that merely needs one. */
export function inertDocumentRelay(): DocumentRelay {
  return {
    publish: async () => undefined,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
  } as unknown as DocumentRelay;
}
