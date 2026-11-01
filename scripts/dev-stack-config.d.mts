// Types of scripts/dev-stack-config.mjs for its TypeScript callers (the browser tests of apps/e2e).
type PortName =
  | 'traefik'
  | 'traefikDashboard'
  | 'keycloak'
  | 'postgres'
  | 'valkey'
  | 'rustfsS3'
  | 'rustfsConsole'
  | 'aspireDashboard'
  | 'aspireDashboardOtlp'
  | 'bff'
  | 'realtime'
  | 'backend'
  | 'frontendDev';
type UrlName =
  | 'app'
  | 'keycloak'
  | 'issuer'
  | 'frontendDev'
  | 'bff'
  | 'realtime'
  | 'backend'
  | 'aspireDashboard';
type Env = Record<string, string | undefined>;

export interface Stack {
  name: string;
  offset: number;
  isDefault: boolean;
  ports: Record<PortName, number>;
  urls: Record<UrlName, string>;
}

export const DEFAULT_STACK: string;
export const DEFAULT_PORTS: Readonly<Record<PortName, number>>;
export function readDotenv(path: string): Record<string, string>;
export function stackSettings(env: Env, dotenv?: Env): Stack;
export function composeEnvironment(stack: Stack): Record<string, string>;
export function hostAppSettings(
  stack: Stack,
): Record<'bff' | 'realtime' | 'backend', Record<string, string>>;
export function usesUserSecrets(stack: Stack): boolean;
export function shellEnvironment(
  stack: Stack,
  context?: { realtimeDotenv?: Record<string, string>; traefikStaticConfig?: string },
): Record<string, string>;
export function currentStack(root?: string): Stack;
