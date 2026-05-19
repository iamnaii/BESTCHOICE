import { execSync } from 'child_process';
import { Logger } from '@nestjs/common';

/**
 * SP7.7 — Clone bc_orig DB → bc_finance DB.
 *
 * Strategy: pg_dump + pg_restore. Both DBs must exist; bc_finance must be empty.
 *
 * Required env:
 *   ORIG_DB_URL   — bc_orig connection string (postgres://...)
 *   FINANCE_DB_URL — bc_finance connection string (target, must be empty)
 *   CONFIRM_CLONE=YES_I_AM_SURE
 *   EXPECTED_ORIG_DB_NAME — verify ORIG_DB_URL points to expected DB
 *
 * DESTRUCTIVE in the sense that FINANCE_DB_URL data is overwritten (must be empty first).
 */

const logger = new Logger('CloneOrigToFinance');

function assertEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    logger.error(`Missing required env: ${key}`);
    process.exit(1);
  }
  return v as string;
}

function main() {
  if (process.env.CONFIRM_CLONE !== 'YES_I_AM_SURE') {
    logger.error('CONFIRM_CLONE=YES_I_AM_SURE required.');
    process.exit(1);
  }

  const origUrl = assertEnv('ORIG_DB_URL');
  const finUrl = assertEnv('FINANCE_DB_URL');
  const expectedName = assertEnv('EXPECTED_ORIG_DB_NAME');

  if (!origUrl.includes(expectedName)) {
    logger.error(
      `ORIG_DB_URL does not contain expected DB name "${expectedName}" — refusing to run`,
    );
    process.exit(1);
  }

  if (origUrl === finUrl) {
    logger.error('Source and target are the same DB — refusing');
    process.exit(1);
  }

  logger.log('Cooldown 5s — Ctrl+C to abort');
  execSync('sleep 5');

  const dumpFile = `/tmp/bc-orig-${Date.now()}.sql`;
  logger.log(`pg_dump → ${dumpFile}`);
  execSync(`pg_dump --no-owner --no-privileges "${origUrl}" > ${dumpFile}`, { stdio: 'inherit' });

  logger.log(`pg_restore → bc_finance`);
  execSync(`psql "${finUrl}" -f ${dumpFile}`, { stdio: 'inherit' });

  execSync(`rm -f ${dumpFile}`);
  logger.log('Clone complete. Verify row counts before proceeding to extract-shop.');
}

main();
