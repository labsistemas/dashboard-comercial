import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const passwordSchema = z.string().min(8).refine(
  value => Buffer.byteLength(value, 'utf8') <= 72,
  'A senha deve ter no máximo 72 bytes',
);

// Password changes invalidate previously issued sessions without storing the hash in JWTs.
export function sessionFingerprint(passwordHash: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not defined');
  return crypto.createHmac('sha256', secret).update(passwordHash).digest('hex');
}

export function verifySession(token: string, secret: string) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || typeof payload.userId !== 'string' ||
      !payload.userId || typeof payload.session !== 'string' || typeof payload.exp !== 'number') {
    throw new Error('Invalid session');
  }
  return payload as jwt.JwtPayload & { userId: string; session: string };
}

export function validateStorageKey(key: string) {
  if (!key || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key) ||
      key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid storage key');
  }
  return key;
}
