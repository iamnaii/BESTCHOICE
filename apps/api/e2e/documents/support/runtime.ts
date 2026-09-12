import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Fail-closed runtime checks for the documents integration harness.
 *
 * The harness boots the real AppModule, so it must never inherit an application
 * database, a real bucket or any outbound provider credential. `tools/docs-integration.sh`
 * provisions everything below; specs refuse to start when any piece is missing.
 */
export const DOCS_SHOP_DB = 'bc_docs_shop';
export const DOCS_FINANCE_DB = 'bc_docs_finance';

/** Variables the runner pins to '' so no .env file can re-enable an outbound provider. */
export const OUTBOUND_PROVIDER_VARS = [
  'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET',
  'LINE_FINANCE_CHANNEL_ACCESS_TOKEN', 'LINE_FINANCE_CHANNEL_SECRET',
  'LINE_STAFF_CHANNEL_ACCESS_TOKEN', 'LINE_STAFF_NOTIFY_TARGETS',
  'LINE_LOGIN_CHANNEL_SECRET', 'LIFF_CHANNEL_ID',
  'SMS_API_KEY', 'SMS_API_SECRET',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'ANTHROPIC_API_KEY', 'SENTRY_DSN',
  'FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_APP_SECRET',
  'PAYSOLUTIONS_MERCHANT_ID', 'PAYSOLUTIONS_SECRET_KEY', 'PAYSOLUTIONS_API_KEY',
  'GCS_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
  'CLOUDFLARE_TURNSTILE_SECRET',
] as const;

export function docsOutputDir(): string {
  const dir = process.env.DOCS_QA_OUTPUT;
  if (!dir) throw new Error('DOCS_QA_OUTPUT is not set — run bash tools/docs-integration.sh');
  return dir;
}

export function assertDisposableRuntime(): void {
  const shop = process.env.DATABASE_URL ?? '';
  const finance = process.env.DATABASE_URL_FINANCE ?? '';
  const pattern = (db: string) => new RegExp(`/${db}\\?host=[^&]*bc-docs\\.`);
  if (!pattern(DOCS_SHOP_DB).test(shop)) {
    throw new Error(`Documents harness only runs against its disposable SHOP database (${DOCS_SHOP_DB}) — run bash tools/docs-integration.sh`);
  }
  if (!pattern(DOCS_FINANCE_DB).test(finance)) {
    throw new Error(`Documents harness only runs against its disposable FINANCE database (${DOCS_FINANCE_DB}) — run bash tools/docs-integration.sh`);
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Documents harness refuses NODE_ENV=production');
  const storage = process.env.STORAGE_LOCAL_DIR;
  if (!storage || !existsSync(storage)) throw new Error('STORAGE_LOCAL_DIR must point at an existing private directory for this run');
  const output = docsOutputDir();
  if (!existsSync(join(output))) throw new Error(`DOCS_QA_OUTPUT does not exist: ${output}`);
  const leaked = OUTBOUND_PROVIDER_VARS.filter((key) => (process.env[key] ?? '') !== '');
  if (leaked.length) throw new Error(`Outbound provider credentials must be empty in the documents harness: ${leaked.join(', ')}`);
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) throw new Error('JWT_SECRET / JWT_REFRESH_SECRET must be set by the runner');
  if (!process.env.PUPPETEER_EXECUTABLE_PATH || !existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    throw new Error('PUPPETEER_EXECUTABLE_PATH must point at a Chromium binary — the runner resolves it; set it explicitly if auto-detection fails');
  }
}
