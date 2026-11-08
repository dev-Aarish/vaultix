import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedToken {
  token: string;
  tokenHash: string;
}

export function generateToken(): GeneratedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
