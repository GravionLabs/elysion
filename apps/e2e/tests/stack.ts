import { composeEnvironment, currentStack } from '../../../scripts/dev-stack-config.mjs';

/**
 * The stack the tests run against: this checkout's (ELYSION_STACK and ELYSION_PORT_OFFSET in the environment or the root
 * `.env`, scripts/dev-stack-config.mjs, #890), so a second stack of another worktree is tested without more settings.
 * `E2E_BASE_URL` and `E2E_KEYCLOAK_URL` still win.
 */
const stack = currentStack();

export const BASE_URL = process.env.E2E_BASE_URL ?? stack.urls.app;
export const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? stack.urls.keycloak;
/** What `docker compose` needs to address this stack (its project name and ports); empty for the default stack. */
export const COMPOSE_ENV = composeEnvironment(stack);
