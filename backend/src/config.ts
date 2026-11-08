export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  env: NodeEnv;
  port: number;
  databaseUrl: string;
  logLevel: string;
  trustProxy: boolean | number;
  sessionTtlHours: number;
  invitationTtlHours: number;
  passwordMinLength: number;
  requireAdminApproval: boolean;
  deviceChallengeTtlMinutes: number;
  corsOrigins: string[];
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  const normalised = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  throw new Error(`Invalid boolean for ${name}: ${value}`);
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${value}`);
  }
  return parsed;
}

function parseTrustProxy(value: string | undefined): boolean | number {
  if (value === undefined || value === '' || value.trim().toLowerCase() === 'false') return false;
  if (value.trim().toLowerCase() === 'true') return true;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid TRUST_PROXY value: ${value}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as NodeEnv;
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    env: nodeEnv,
    port: parsePositiveInt('PORT', env.PORT, 3000),
    databaseUrl,
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionTtlHours: parsePositiveInt('SESSION_TTL_HOURS', env.SESSION_TTL_HOURS, 12),
    invitationTtlHours: parsePositiveInt('INVITATION_TTL_HOURS', env.INVITATION_TTL_HOURS, 72),
    passwordMinLength: parsePositiveInt('PASSWORD_MIN_LENGTH', env.PASSWORD_MIN_LENGTH, 12),
    requireAdminApproval: parseBoolean('REQUIRE_ADMIN_APPROVAL', env.REQUIRE_ADMIN_APPROVAL, true),
    deviceChallengeTtlMinutes: parsePositiveInt(
      'DEVICE_CHALLENGE_TTL_MINUTES',
      env.DEVICE_CHALLENGE_TTL_MINUTES,
      5,
    ),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
