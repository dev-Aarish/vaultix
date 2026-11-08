import { Algorithm, hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const dummyHashPromise = hash('vaultix-timing-equaliser', ARGON2_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function burnPasswordVerification(password: string): Promise<void> {
  try {
    await verify(await dummyHashPromise, password);
  } catch {
    // Intentionally ignored: this exists only to equalise timing.
  }
}
