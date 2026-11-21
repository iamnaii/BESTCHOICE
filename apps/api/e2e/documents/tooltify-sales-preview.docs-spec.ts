import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as bcrypt from 'bcrypt';
import { startDocumentsApp } from './support/harness';
import { assertDisposableRuntime } from './support/runtime';

const enabled = process.env.TOOLTIFY_SALES_PREVIEW === '1';
(enabled ? it : it.skip)(
  'serves real SHOP history until STOP is created in this private run directory',
  async () => {
    assertDisposableRuntime();
    const out = process.env.DOCS_QA_OUTPUT!;
    const repo = resolve(__dirname, '../../../..');
    const runId = randomUUID();
    if (
      process.env.REDIS_HOST ||
      process.env.CRON_ENABLED !== 'false' ||
      !out.startsWith(join(repo, '.tmp/tooltify-sales/run.'))
    )
      throw Error('Invalid preview environment');
    const app = await startDocumentsApp();
    const apiOrigin = new URL(app.baseUrl).origin;
    const vite = fork(join(repo, 'apps/web/e2e/tooltify-sales-vite.mjs'), [apiOrigin, runId], {
      cwd: repo,
      execArgv: [],
    });
    try {
      const { baseURL } = await new Promise<{ baseURL: string }>((ok, fail) => {
        vite.once('error', fail);
        vite.once('exit', (code) => fail(Error('Vite exited: ' + code)));
        vite.once('message', ok);
      });
      expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(await (await fetch(baseURL + '/__tooltify_run')).json()).toEqual({ runId, apiOrigin });
      expect((await (await fetch(baseURL + '/api')).json()).data.service).toBe('installment-api');
      const db = app.prisma;
      const [identity] = await db.$queryRaw<
        { db: string; socket: string; pid: number }[]
      >`SELECT current_database() AS db, current_setting('unix_socket_directories') AS socket, pg_backend_pid() AS pid`;
      expect(identity.db).toBe('bc_docs_shop');
      expect(new URL(process.env.DATABASE_URL!).searchParams.get('host')).toBe(identity.socket);
      const email = 'sales-history-reader@test.invalid';
      const password = randomUUID();
      const user = await db.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 10),
          name: 'ทดสอบประวัติขาย',
          role: 'ACCOUNTANT',
          accessibleCompanies: ['SHOP'],
          primaryCompany: 'SHOP',
          accessManaged: true,
        },
      });
      const position = await db.accessPosition.create({
        data: {
          code: 'HISTORY_READ',
          name: 'ทดสอบอ่านประวัติ',
          permissions: ['imported-sales.read'],
        },
      });
      await db.employeeAccessAssignment.create({
        data: { userId: user.id, positionId: position.id, companyCode: 'SHOP', scope: 'COMPANY' },
      });
      const common = {
        source: 'TOOLTIFY',
        barcode: '001234567890123',
        productName: 'โทรศัพท์ทดสอบ',
        buyerLabel: 'ผู้ซื้อทดสอบ',
        shopLabel: 'ทดสอบ',
        category: 'มือถือ',
        saleChannel: 'CASH',
        paymentType: 'CASH',
        priceGroup: 'Retail',
        salespersonName: 'พนักงานทดสอบ',
        salePrice: '1234.56',
        listPrice: '1234.56',
        costTotal: '789.34',
        profit: '445.22',
        importBatch: runId,
      };
      await db.importedSale.createMany({
        data: [
          { ...common, orderNumber: 'TT-TEST-001', soldAt: new Date('2026-11-01T08:00:00+07:00') },
          { ...common, orderNumber: 'TT-TEST-002', soldAt: new Date('2026-11-02T08:00:00+07:00') },
          {
            ...common,
            orderNumber: 'TT-TEST-002',
            barcode: '001234567890124',
            soldAt: new Date('2026-11-02T08:00:00+07:00'),
          },
        ],
      });
      writeFileSync(
        join(out, 'preview.json'),
        JSON.stringify({
          runId,
          repo,
          baseURL,
          apiOrigin,
          apiPid: process.pid,
          vitePid: vite.pid,
          pgSocket: identity.socket,
          chromium: process.env.PUPPETEER_EXECUTABLE_PATH,
          email,
          password,
          userId: user.id,
        }),
        { mode: 0o600 },
      );
      while (!existsSync(join(out, 'STOP'))) await delay(1000);
      expect(app.external.calls).toHaveLength(0);
    } finally {
      if (vite.connected) vite.disconnect();
      await app.close();
    }
  },
  2_147_483_647,
);
