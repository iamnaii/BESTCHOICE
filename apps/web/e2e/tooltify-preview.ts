import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function tooltifyPreview() {
  const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
  const run = realpathSync(process.env.TOOLTIFY_RUN_DIR || '.');
  if (!run.startsWith(join(repo, '.tmp/tooltify-sales/run.')))
    throw Error(
      'Start tools/tooltify-sales-preview.sh and set TOOLTIFY_RUN_DIR to its private run directory',
    );
  const preview = JSON.parse(readFileSync(join(run, 'preview.json'), 'utf8')) as {
    runId: string;
    repo: string;
    baseURL: string;
    apiOrigin: string;
    chromium: string;
    email: string;
    password: string;
    userId: string;
  };
  if (
    preview.repo !== repo ||
    process.env.BASE_URL !== preview.baseURL ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(preview.baseURL) ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(preview.apiOrigin)
  ) {
    throw Error('BASE_URL must exactly match the loopback feature server owned by this checkout');
  }
  return { ...preview, run };
}
