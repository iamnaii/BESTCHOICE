import { expect as expectBrowser } from '@playwright/test';
import { saveArtifact } from './support/artifacts';
import { seedDocumentsWorld, SIGNATURE_PNG, type DocumentsWorld } from './support/fixtures';
import { startDocumentsApp, type DocumentsHarness, type Session } from './support/harness';
import { startWeb, type WebRuntime } from './support/web';

describe('Icon acceptance across isolated document and LIFF API routes', () => {
  let harness: DocumentsHarness;
  let world: DocumentsWorld;
  let web: WebRuntime;
  let owner: Session;
  const filename = 'synthetic-icon-evidence.png';

  beforeAll(async () => {
    harness = await startDocumentsApp();
    world = await seedDocumentsWorld(harness.prisma);
    owner = await harness.login(world.users.owner.email, world.password);
    const contract = `/contracts/${world.contracts.a.id}`;
    await harness
      .client({ session: owner })
      .post(`${contract}/documents`, {
        documentType: 'DEVICE_PHOTO',
        fileName: filename,
        fileUrl: SIGNATURE_PNG,
        mimeType: 'image/png',
      })
      .expect(201);
    web = await startWeb(harness);
  }, 120_000);

  afterAll(async () => {
    await web?.close();
    await harness?.close();
  });

  for (const width of [390, 1440]) {
    it(`renders real contract evidence, file view and delete dialog at ${width}px`, async () => {
      const { page, context, errors } = await web.page({ width, height: 900 });
      try {
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === web.origin ? route.continue() : route.abort(),
        );
        await page.addInitScript(
          (token) => localStorage.setItem('access_token', token),
          owner.token,
        );
        await page.goto(`${web.origin}/contracts/${world.contracts.a.id}?zone=shop`, {
          waitUntil: 'domcontentloaded',
        });
        await expectBrowser(
          page.getByText(world.contracts.a.contractNumber, { exact: true }).first(),
        ).toBeVisible({ timeout: 25_000 });
        const signingStatus = page.getByRole('img', { name: /^(ยังไม่ได้ลงนาม|ลงนามแล้ว)$/ }).first();
        await expectBrowser(signingStatus).toBeVisible();
        expect(await signingStatus.ariaSnapshot()).toMatch(/img "(ยังไม่ได้ลงนาม|ลงนามแล้ว)"/);
        const documents = page.waitForResponse((response) =>
          new URL(response.url()).pathname.endsWith('/documents'),
        );
        await page
          .getByRole('button', { name: /^เอกสาร(?:\s|$)/ })
          .first()
          .click();
        expect((await documents).status()).toBe(200);

        const file = page.getByRole('button', { name: 'ดูเอกสาร', exact: true });
        const remove = page.getByRole('button', { name: 'ลบเอกสาร', exact: true });
        await expectBrowser(file.locator('svg.app-icon-eye')).toHaveAttribute(
          'data-icon-style',
          'duotone',
        );
        await expectBrowser(remove.locator('svg.app-icon-trash')).toHaveAttribute(
          'data-icon-style',
          'duotone',
        );
        const card = page.getByText('รูปถ่ายสินค้า', { exact: true }).locator('..');
        await expectBrowser(card.locator('svg.app-icon-check-circle')).toHaveAttribute(
          'fill',
          'currentColor',
        );
        const content = page.waitForResponse((response) =>
          new URL(response.url()).pathname.endsWith('/content'),
        );
        await file.press('Enter');
        expect((await content).status()).toBe(200);
        const dialog = page.getByRole('dialog', { name: `ดูเอกสาร ${filename}` });
        const image = dialog.getByRole('img', { name: filename });
        await expectBrowser(image).toBeVisible();
        const decoded = await image.evaluate(async (node: HTMLImageElement) => {
          await node.decode();
          return {
            complete: node.complete,
            protocol: new URL(node.currentSrc).protocol,
            width: node.naturalWidth,
            height: node.naturalHeight,
          };
        });
        expect(decoded).toEqual({ complete: true, protocol: 'blob:', width: 1, height: 1 });
        const close = dialog.getByRole('button', { name: 'ปิดเอกสาร' });
        await expectBrowser(close).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        saveArtifact(
          'icons-browser',
          `contract-evidence-view-${width}.png`,
          await page.screenshot(),
        );
        await close.press('Enter');
        await expectBrowser(file).toBeFocused();
        await remove.press('Enter');
        const confirmation = page.getByRole('dialog');
        await expectBrowser(confirmation).toContainText(filename);
        saveArtifact(
          'icons-browser',
          `contract-evidence-delete-${width}.png`,
          await page.screenshot(),
        );
        await confirmation.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
        await expectBrowser(file).toBeVisible();
        expect(errors.filter((error) => error.startsWith('pageerror:'))).toEqual([]);
      } finally {
        await context.close();
      }
    }, 90_000);
  }

  it('serves staff signing prerequisites and denies LIFF preferences without LINE credentials', async () => {
    const client = harness.client({ session: owner });
    const contract = `/contracts/${world.contracts.a.id}`;
    await client.get(`${contract}/kyc/status`).expect(200);
    await client.get(`${contract}/preview`).expect(200);
    await client.get(`${contract}/signatures`).expect(200);
    const anonymous = harness.client({ session: null });
    const preferences = '/line-oa/liff/notification-preferences';
    await anonymous.get(preferences).expect(401);
    await anonymous
      .post(preferences, {
        paymentReminder: true,
        overdueNotice: false,
        receiptNotification: true,
      })
      .expect(401);
    expect(harness.external.calls).toEqual([]);
  });
});
