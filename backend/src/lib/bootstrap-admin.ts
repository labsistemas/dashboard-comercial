import crypto from 'crypto';

let setupCode: string | null = null;

export function initializeAdminSetup() {
  setupCode = crypto.randomBytes(32).toString('hex');
  console.warn(`Primeiro acesso — código de instalação do administrador: ${setupCode}`);
}

export function verifyAdminSetupCode(input: unknown) {
  if (!setupCode || typeof input !== 'string') return false;
  const provided = Buffer.from(input);
  const expected = Buffer.from(setupCode);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export function completeAdminSetup() {
  setupCode = null;
}
