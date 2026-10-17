import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { assertDisposableRuntime, docsOutputDir } from '../documents/support/runtime';
import { startDocumentsApp } from '../documents/support/harness';
import { startWeb } from '../documents/support/web';
import { seedBacklogFixtures } from './backlog-fixtures';

// Run the existing role/CRUD/browser suite on this checkout's API, never a
// developer's database or the default localhost:3000 service.
describe('Whole-system browser regression on disposable data', () => {
  it('runs the existing web E2E suite against its own seeded API', async () => {
    assertDisposableRuntime();
    const root = resolve(__dirname, '../../../..');
    const run = (args: string[], cwd: string, env = process.env) =>
      new Promise<number>((done, reject) => {
        const childEnv = { ...env };
        delete childEnv.JEST_WORKER_ID;
        const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', (code) => done(code ?? 1));
      });
    // This destructive standard dev seed is deliberately AFTER the fail-closed
    // database/provider checks above and only touches the runner's private DB.
    expect(
      await run(
        ['-r', 'ts-node/register/transpile-only', 'prisma/seed.ts'],
        resolve(root, 'apps/api'),
      ),
    ).toBe(0);
    const h = await startDocumentsApp();
    const web = await startWeb(h);
    const authFiles = ['.playwright-auth.json', '.playwright-roles-auth.json'].map((name) =>
      resolve(root, 'apps/web', name),
    );
    const previous = authFiles.map((file) => (existsSync(file) ? readFileSync(file) : null));
    const previousWebhookSecret = process.env.PAYSOLUTIONS_WEBHOOK_SECRET;
    try {
      const fixtures = await seedBacklogFixtures(h);
      const fixtureFile = resolve(docsOutputDir(), 'backlog-fixtures.json');
      writeFileSync(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
      const config = resolve(root, 'apps/web/playwright.system-audit.config.ts');
      const args = [
        resolve(root, 'node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        config,
      ];
      if (process.env.SYSTEM_E2E_GREP) args.push('--grep', process.env.SYSTEM_E2E_GREP);
      expect(
        await run(args, resolve(root, 'apps/web'), {
          ...process.env,
          BASE_URL: web.origin,
          API_DIRECT_URL: h.baseUrl.replace(/\/api$/, ''),
          SYSTEM_E2E_OUTPUT: docsOutputDir(),
          SYSTEM_E2E_FIXTURES: fixtureFile,
        }),
      ).toBe(0);
      const report = JSON.parse(
        readFileSync(resolve(docsOutputDir(), 'playwright-results.json'), 'utf8'),
      );
      expect(report.stats.skipped).toBe(0);
      expect(report.stats.flaky).toBe(0);
    } finally {
      if (previousWebhookSecret === undefined) delete process.env.PAYSOLUTIONS_WEBHOOK_SECRET;
      else process.env.PAYSOLUTIONS_WEBHOOK_SECRET = previousWebhookSecret;
      for (let i = 0; i < authFiles.length; i++) {
        if (previous[i]) writeFileSync(authFiles[i], previous[i]!);
        else if (existsSync(authFiles[i])) unlinkSync(authFiles[i]);
      }
      await web.close();
      await h.close();
    }
  }, 7_200_000);
});
