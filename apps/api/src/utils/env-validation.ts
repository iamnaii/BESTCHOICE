/**
 * Validates required environment variables at application startup
 * Fails fast with clear error messages if critical vars are missing or malformed
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  { key: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string' },
  { key: 'JWT_SECRET', required: true, description: 'JWT access token secret' },
  { key: 'JWT_REFRESH_SECRET', required: true, description: 'JWT refresh token secret' },
  { key: 'ENCRYPTION_KEY', required: false, description: 'AES encryption key for national IDs' },
  { key: 'FRONTEND_URL', required: false, description: 'Frontend URL for CORS' },
  { key: 'ANTHROPIC_API_KEY', required: false, description: 'Anthropic API key for AI credit check and OCR' },
];

export function validateEnv(): void {
  const missing: string[] = [];

  for (const envVar of ENV_VARS) {
    if (envVar.required && !process.env[envVar.key]) {
      missing.push(`  - ${envVar.key}: ${envVar.description}`);
    }
  }

  if (missing.length > 0) {
    const message = [
      'Missing required environment variables:',
      ...missing,
      '',
      'Please set these in your .env file or environment.',
    ].join('\n');
    throw new Error(message);
  }

  // Production-only encryption requirements
  if (process.env.NODE_ENV === 'production') {
    validatePiiEncryptionEnv();
    validateTotpEncryptionEnv();
  }
}

function validatePiiEncryptionEnv(): void {
  const piiKey = process.env.PII_ENCRYPTION_KEY;
  if (!piiKey) {
    throw new Error(
      'PII_ENCRYPTION_KEY required in production. Generate via: openssl rand -hex 32'
    );
  }
  if (piiKey.length !== 64 || !/^[0-9a-f]+$/i.test(piiKey)) {
    throw new Error(
      'PII_ENCRYPTION_KEY must be 64 hex chars (32 bytes for AES-256)'
    );
  }

  const piiSalt = process.env.PII_HASH_SALT;
  if (!piiSalt) {
    throw new Error(
      'PII_HASH_SALT required in production. Generate via: openssl rand -hex 32'
    );
  }
  if (piiSalt.length < 32) {
    throw new Error('PII_HASH_SALT must be >= 32 chars');
  }
}

/**
 * (Audit finding P1) ENCRYPTION_KEY is used by TwoFactorService.encrypt() to
 * AES-256-CBC the TOTP secret before storing it in the DB. If the key is
 * missing in production the service silently falls back to plaintext storage,
 * which defeats the entire 2FA threat model. Refuse to start without it.
 */
function validateTotpEncryptionEnv(): void {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      'ENCRYPTION_KEY (>= 16 chars) required in production for TOTP secret encryption. Generate via: openssl rand -hex 32'
    );
  }
}
