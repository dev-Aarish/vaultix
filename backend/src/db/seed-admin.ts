import 'dotenv/config';
import { z } from 'zod';
import { loadConfig } from '../config';
import { hashPassword } from '../lib/password';
import { UserService } from '../services/users';
import { createPool } from './pool';

async function main(): Promise<void> {
  const config = loadConfig();

  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = (process.env.ADMIN_NAME ?? '').trim() || 'Administrator';

  if (!email || !z.email().safeParse(email).success) {
    throw new Error('ADMIN_EMAIL must be a valid email address');
  }
  if (password.length < config.passwordMinLength) {
    throw new Error(`ADMIN_PASSWORD must be at least ${config.passwordMinLength} characters`);
  }

  const pool = createPool(config);
  try {
    const passwordHash = await hashPassword(password);
    const user = await UserService.createAdmin(pool, {
      name,
      email,
      passwordHash,
      emailVerified: true,
    });
    console.log(`Administrator ready: ${user.email} (${user.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
