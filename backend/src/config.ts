import path from 'node:path';

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
  rateLimitEnabled: boolean;
  sessionInactivityMinutes: number;
  fileStorageDir: string;
  fileEncryptionKeyFile: string;
  fileEncryptionKek: string | null;
  maxUploadBytes: number;
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

function parseStorageDir(value: string | undefined): string {
  const directory = value && value.trim().length > 0 ? value.trim() : path.join(process.cwd(), 'storage');
  return path.resolve(directory);
}

function parseOptionalKey(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const normalised = value.trim();
  const key = Buffer.from(normalised, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== normalised.replace(/=+$/, '')) {
    throw new Error('FILE_ENCRYPTION_KEK must be a Base64-encoded 32-byte key');
  }
  return normalised;
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

  const fileStorageDir = parseStorageDir(env.FILE_STORAGE_DIR);
  const fileEncryptionKeyFile = env.FILE_ENCRYPTION_KEY_FILE
    ? path.resolve(env.FILE_ENCRYPTION_KEY_FILE)
    : path.join(fileStorageDir, '.master-key');

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
    rateLimitEnabled: parseBoolean('RATE_LIMIT_ENABLED', env.RATE_LIMIT_ENABLED, nodeEnv !== 'test'),
    sessionInactivityMinutes: parsePositiveInt(
      'SESSION_INACTIVITY_MINUTES',
      env.SESSION_INACTIVITY_MINUTES,
      60,
    ),
    fileStorageDir,
    fileEncryptionKeyFile,
    fileEncryptionKek: parseOptionalKey(env.FILE_ENCRYPTION_KEK),
    maxUploadBytes: parsePositiveInt(
      'FILE_MAX_UPLOAD_BYTES',
      env.FILE_MAX_UPLOAD_BYTES,
      25 * 1024 * 1024,
    ),
  };
}
