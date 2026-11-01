// The dev server's proxy (`ng serve`, read when it starts): /api to the BFF and /yjs to the realtime service on the host.
// Their ports are those of this checkout's stack (3000 and 3001, plus ELYSION_PORT_OFFSET for a second stack, #890).
import { currentStack } from '../../scripts/dev-stack-config.mjs';

const { urls } = currentStack();

export default {
  '/api': { target: urls.bff, secure: false },
  '/yjs': { target: urls.realtime, secure: false, ws: true },
};
