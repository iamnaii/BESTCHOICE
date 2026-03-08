/**
 * Validates required environment variables at application startup
 * Fails fast with clear error messages if critical vars are missing
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
}
