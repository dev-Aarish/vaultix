import 'dotenv/config';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://localhost:5432/vaultix_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
process.env.LOG_LEVEL = 'silent';
process.env.SESSION_TTL_HOURS = '12';
process.env.INVITATION_TTL_HOURS = '72';
process.env.PASSWORD_MIN_LENGTH = '12';
process.env.REQUIRE_ADMIN_APPROVAL = 'true';
process.env.TRUST_PROXY = 'false';
