import { test, expect, type Page } from '@playwright/test';
import { installSellApiFixtures, sellData } from './fixtures/sell-api';
const profile = sellData.profiles['iPhone 17 Pro|256GB'];
for (const code of ['QUOTE_EXPIRED', 'QUOTE_INVALID'])
  test(`server ${code} remains blocked after focus and elapsed checks`, async ({ page }) => {
    await page.clock.install();
    await installSellApiFixtures(page);
    await page.route('**/api/shop/buyback/submit', (route) =>
      route.fulfill({ status: 400, json: { code, message: 'กรุณาประเมินราคาใหม่' } }),
    );
    await start(page);
    await assess(page);
    await page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' }).click();
    await page.getByLabel('ชื่อ-นามสกุล', { exact: true }).fill('ลูกค้าทดสอบ');
    await page.getByLabel('เบอร์โทร (10 หลัก)', { exact: true }).fill('0812345678');
    await page.getByRole('button', { name: 'ส่งข้อมูลขายสด', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ประเมินราคาใหม่', exact: true })).toBeVisible();
    await page.clock.fastForward(31000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: 'ประเมินราคาใหม่', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' })).toHaveCount(0);
  });
for (const width of [390, 1280])
  test(`${width}px summary keeps its 24 hour window across flow and review, then expires`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install();
    const log = await installSellApiFixtures(page);
    await start(page);
    await assess(page);
    const times = await page
      .locator('time')
      .evaluateAll((els) => els.map((el) => el.getAttribute('datetime')));
    expect(Date.parse(times[1]!) - Date.parse(times[0]!)).toBe(86400000);
    await expect(
      page.getByRole('complementary', { name: 'เงื่อนไขรับซื้อและเทิร์น' }),
    ).toContainText('ออกจาก iCloud ได้');
    await page.getByRole('button', { name: 'เทิร์นซื้อเครื่อง', exact: true }).click();
    await expect(page.locator('time').first()).toHaveAttribute('datetime', times[0]!);
    await page.getByRole('button', { name: 'ตรวจหรือแก้คำตอบ' }).click();
    await page.getByRole('button', { name: 'ดูราคาประเมิน' }).click();
    expect(log.quotePayloads).toHaveLength(1);
    await expect(page.locator('time').last()).toHaveAttribute('datetime', times[1]!);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`summary-${width}.png`), fullPage: true });
    await page.clock.fastForward(86400001);
    await expect(page.getByText('พ้นช่วงอ้างอิงแล้ว', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' })).toHaveCount(0);
    expect(log.submitRequests).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath(`summary-expired-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'ประเมินราคาใหม่', exact: true }).click();
    await expect(page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' })).toBeVisible();
    expect(log.quotePayloads).toHaveLength(2);
  });
test('expiry while entering contact information prevents submission', async ({ page }) => {
  await page.clock.install();
  const log = await installSellApiFixtures(page);
  await start(page);
  await assess(page);
  await page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน' }).click();
  await page.clock.fastForward(86400001);
  await expect(page.getByRole('alert')).toContainText('พ้นช่วงอ้างอิง 24 ชั่วโมง');
  expect(log.submitRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'กลับไปดูผลประเมิน' }).click();
  await expect(page.getByRole('button', { name: 'ประเมินราคาใหม่' })).toBeVisible();
});
for (const width of [320, 1280])
  test(`${width}px warranty help is collapsed and can be toggled without blocking answers`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await installSellApiFixtures(page);
    await start(page);
    await page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ประกัน Apple');
    const help = page.getByRole('region', { name: 'วิธีเช็กประกัน' });
    const toggle = page.locator('summary').filter({ hasText: 'ดูวิธีเช็กประกัน' });
    await expect(help).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'ประกันเหลือมากกว่า 4 เดือน', exact: true }),
    ).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`warranty-collapsed-${width}.png`),
      fullPage: true,
    });
    await toggle.focus();
    await toggle.press('Enter');
    await expect(help).toBeVisible();
    await expect(help).toContainText('checkcoverage.apple.com');
    await expect(help).toContainText('ถ้าเหลือพอดี 4 เดือน ให้เลือกน้อยกว่า 4 เดือน');
    await expect(help).toContainText('แตะคำตอบแล้วไปต่อได้เลย');
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`warranty-expanded-${width}.png`),
      fullPage: true,
    });
    await toggle.click();
    await expect(help).not.toBeVisible();
    await page.getByRole('button', { name: 'ประกันเหลือมากกว่า 4 เดือน', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(profile.questions[2].title);
  });
for (const width of [320, 1280])
  test(`${width}px origin offers only Thai and imported choices and blocks imported quotes`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    const log = await installSellApiFixtures(page);
    await start(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
    await expect(page.locator('input')).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'โมเดลไทยหรือโมเดลนอก' }).getByRole('button'),
    ).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: 'ไม่แน่ใจ / ดูไม่เป็น', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true })).toBeEnabled();
    const guide = page.getByRole('region', { name: 'วิธีเช็กโมเดลเครื่อง' });
    const toggleGuide = page.locator('summary').filter({ hasText: 'ดูไม่เป็น? กดดูวิธีเช็ก' });
    await expect(guide).not.toBeVisible();
    await toggleGuide.focus();
    await toggleGuide.press('Enter');
    await expect(page.getByRole('region', { name: 'วิธีเช็กโมเดลเครื่อง' })).toContainText(
      'Settings → General → About',
    );
    await expect(guide).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`origin-guide-expanded-${width}.png`),
      fullPage: true,
    });
    await toggleGuide.press('Enter');
    await expect(guide).not.toBeVisible();
    await page.getByRole('button', { name: 'เครื่องโมเดลนอก', exact: true }).click();
    await expect(page.getByRole('status', { name: 'ผลการเช็กโมเดล' })).toContainText(
      'ร้านไม่รับเครื่องโมเดลนอก',
    );
    expect(log.quotePayloads).toHaveLength(0);
    expect(log.submitRequests).toHaveLength(0);
    const help = page.getByRole('link', { name: 'ให้ร้านช่วยเช็กทาง LINE' });
    const message = decodeURIComponent(
      new URL((await help.getAttribute('href')) as string).search.slice(1),
    );
    expect(message).toContain('iPhone 17 Pro 256GB');
    expect(message).toContain('รหัสในแถวหมายเลขรุ่น');
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`origin-help-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ประกัน Apple');
    await page.goBack();
    await page.getByRole('button', { name: 'เครื่องโมเดลนอก', exact: true }).click();
    await page.goForward();
    // Browser Forward must not turn a rejected answer into a usable quote.
    for (const question of profile.questions.slice(1)) {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(question.title);
      await page
        .getByRole('button', {
          name:
            question.selectType === 'SINGLE' ? question.choices[0].label : 'ใช้งานได้ปกติทุกอย่าง',
          exact: true,
        })
        .click();
    }
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
    expect(log.quotePayloads).toHaveLength(0);
    expect(log.submitRequests).toHaveLength(0);
  });
test('iPhone 13 guide explains M and TH/A without requiring code entry', async ({ page }) => {
  await installSellApiFixtures(page);
  await page.route('**/api/shop/buyback/catalog', (route) =>
    route.fulfill({
      json: {
        models: [
          { model: 'iPhone 13 Pro Max', storages: [{ storage: '256GB', maxPrice: '20000' }] },
        ],
      },
    }),
  );
  await page.route('**/api/shop/buyback/questions?**', (route) => route.fulfill({ json: profile }));
  await page.goto('/sell/quote?model=iPhone%2013%20Pro%20Max&storage=256GB');
  await page.locator('summary').filter({ hasText: 'ดูไม่เป็น? กดดูวิธีเช็ก' }).click();
  await expect(page.getByRole('region', { name: 'วิธีเช็กโมเดลเครื่อง' })).toContainText(
    'MxxxxTH/A',
  );
  await expect(page.locator('input')).toHaveCount(0);
  const thai = page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true });
  await thai.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ประกัน Apple');
});
for (const width of [320, 1280])
  test(`${width}px LINE and map links open the intended destination and preserve the assessment`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await installSellApiFixtures(page);
    // External destinations are intercepted before navigation; no LINE message or map request is sent.
    await page
      .context()
      .route('https://line.me/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>LINE destination intercepted</p>' }),
      );
    await page
      .context()
      .route('https://www.google.com/maps/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Maps destination intercepted</p>' }),
      );
    await start(page);
    await assess(page);
    await page.getByRole('button', { name: 'เทิร์นซื้อเครื่อง', exact: true }).click();
    const contact = page.getByRole('region', { name: 'ติดต่อร้านเรื่องขายหรือเทิร์น' });
    for (const name of ['ทัก LINE', 'แอด LINE', 'แผนที่ร้าน']) {
      const popupPromise = page.waitForEvent('popup');
      await contact.getByRole('link', { name, exact: true }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      const destination = new URL(popup.url());
      if (name === 'ทัก LINE') {
        expect(destination.pathname).toBe('/R/oaMessage/%40bestchoice/');
        const message = decodeURIComponent(destination.search.slice(1));
        expect(message).toContain('iPhone 17 Pro 256GB');
        expect(message).toContain('เครดิตเทิร์นโดยประมาณ 28,500 บาท');
        expect(message).toContain('ไม่จ่ายเป็นเงินสด');
      } else if (name === 'แอด LINE') expect(destination.pathname).toBe('/R/ti/p/@bestchoice');
      else
        expect(destination.searchParams.get('query_place_id')).toBe('ChIJvw20uboBHjERsefpWFx4SPs');
      await popup.close();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('สรุปราคาเครื่องของคุณ');
    }
    await noOverflow(page);
  });

test('desktop shows series and models together; reduced motion keeps the next step still', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installSellApiFixtures(page);
  await page.route('**/api/shop/buyback/catalog', (route) =>
    route.fulfill({
      json: {
        models: [
          ...sellData.catalog.models,
          ...['iPhone 17 Pro Max', 'iPhone 17', 'iPhone 15', 'iPhone 14', 'iPhone 13'].map(
            (model) => ({ ...sellData.catalog.models[0], model }),
          ),
        ],
      },
    }),
  );
  await page.goto('/sell/quote');
  await page.getByRole('button', { name: 'กลุ่ม iPhone 17', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'iPhone 17 Pro Max', exact: true }),
  ).toBeInViewport();
  await expect(page.getByRole('button', { name: 'iPhone 17', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('desktop-series-models.png'), fullPage: true });
  await page.getByRole('button', { name: 'iPhone 17 Pro', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องมีความจุเท่าไร?');
  expect(
    await page.locator('.sell-step-content').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});
test('selection feedback keeps its colors and does not insert a jumping footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installSellApiFixtures(page);
  await page.goto('/sell/quote');
  await page.getByRole('button', { name: 'กลุ่ม iPhone 17', exact: true }).click();
  const selected = page.getByRole('button', { name: 'iPhone 17 Pro', exact: true });
  const other = page.getByRole('button', { name: 'กลุ่ม iPhone 16', exact: true });
  const before = await other.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.clock.pauseAt(new Date());
  await selected.click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(await other.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before);
  expect(await selected.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
  const status = page.getByText('กำลังไปต่อ…', { exact: true });
  expect(await status.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await page.clock.runFor(500);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องมีความจุเท่าไร?');
});
async function start(page: Page) {
  await page.goto('/sell/quote?utm_source=test');
  await page.getByRole('button', { name: 'กลุ่ม iPhone 17', exact: true }).click();
  await page.getByRole('button', { name: 'iPhone 17 Pro', exact: true }).click();
  await page.getByRole('button', { name: '256 GB', exact: true }).click();
}
async function assess(page: Page, issues = false) {
  for (const question of profile.questions) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      question.key === 'device-origin' ? 'เครื่องนี้เป็นโมเดลไทยไหม?' : question.title,
    );
    if (question.selectType === 'SINGLE')
      await page
        .getByRole('button', {
          name: question.key === 'device-origin' ? 'เครื่องโมเดลไทย' : question.choices[0].label,
          exact: true,
        })
        .click();
    else if (!issues)
      await page.getByRole('button', { name: 'ใช้งานได้ปกติทุกอย่าง', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'มีอาการผิดปกติ', exact: true }).click();
      const confirm = page.getByRole('button', { name: 'ยืนยันอาการ', exact: true });
      await expect(confirm).toBeDisabled();
      for (const choice of question.choices)
        if (!('isNoneChoice' in choice && choice.isNoneChoice))
          await page.getByRole('checkbox', { name: choice.label, exact: true }).check();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        question.key === 'device-origin' ? 'เครื่องนี้เป็นโมเดลไทยไหม?' : question.title,
      );
      for (const choice of question.choices)
        if (!('isNoneChoice' in choice && choice.isNoneChoice))
          await page.getByRole('checkbox', { name: choice.label, exact: true }).uncheck();
      await expect(confirm).toBeDisabled();
      for (const choice of question.choices.slice(0, 2))
        await page.getByRole('checkbox', { name: choice.label, exact: true }).check();
      await confirm.click();
    }
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('สรุปราคาเครื่องของคุณ');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
for (const [width, height] of [
  [320, 740],
  [390, 844],
  [1024, 768],
  [1280, 800],
  [1440, 900],
]) {
  for (const exchange of [false, true])
    test(`${width}px ${exchange ? 'credit with multiple issues' : 'cash without issues'} completes`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height });
      const log = await installSellApiFixtures(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await start(page);
      await noOverflow(page);
      await assess(page, exchange);
      await noOverflow(page);
      expect(log.quotePayloads).toHaveLength(1);
      expect(new URL(page.url()).searchParams.get('utm_source')).toBe('test');
      if (exchange) {
        await page.getByRole('button', { name: 'เทิร์นซื้อเครื่อง', exact: true }).click();
        await expect(page.getByText('12,840 บาท', { exact: true })).toBeVisible();
        await expect(page.getByText(/ไม่จ่ายเป็นเงินสด/)).toBeVisible();
      } else await expect(page.getByText('27,500 บาท', { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`result-${width}-${exchange ? 'credit' : 'cash'}.png`),
        fullPage: true,
      });
      await page
        .getByRole('button', {
          name: exchange ? 'นัดตรวจเครื่องที่ร้าน' : 'นัดตรวจเครื่องที่ร้าน',
          exact: true,
        })
        .click();
      const submit = page.getByRole('button', {
        name: exchange ? 'ส่งข้อมูลเทิร์น' : 'ส่งข้อมูลขายสด',
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await page.getByLabel('ชื่อ-นามสกุล', { exact: true }).fill('ลูกค้าทดสอบ');
      const phone = page.getByLabel('เบอร์โทร (10 หลัก)', { exact: true });
      await phone.fill('081');
      await phone.blur();
      await expect(phone).toHaveAttribute('aria-invalid', 'true');
      await expect(submit).toBeDisabled();
      await phone.fill('081-234-5678');
      await expect(submit).toBeEnabled();
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`contact-${width}-${exchange ? 'credit' : 'cash'}.png`),
        fullPage: true,
      });
      await submit.click();
      await expect(page).toHaveURL(/\/sell\/local-request$/);
      expect(log.submittedPayload?.flow).toBe(exchange ? 'EXCHANGE' : 'BUYBACK');
      expect(log.submittedPayload?.sellerPhone).toBe('0812345678');
      expect(log.submitRequests).toHaveLength(1);
      await expect(
        page.getByText(exchange ? 'มูลค่าเครดิตเทิร์นโดยประมาณ' : 'ราคาขายสดโดยประมาณ', {
          exact: true,
        }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(log.unmatched).toEqual([]);
    });
}
test('back cancels pending navigation, retains answers, and refresh follows validated device link', async ({
  page,
}) => {
  await installSellApiFixtures(page);
  await page.goto('/sell/quote?model=iPhone%2017%20Pro&storage=256GB&utm_source=line');
  await page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(profile.questions[1].title);
  await page
    .getByRole('button', { name: profile.questions[1].choices[0].label, exact: true })
    .click();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  await expect(page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(300);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  await page.reload();
  await expect(page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(new URL(page.url()).searchParams.get('utm_source')).toBe('line');
});
test('keyboard selection, review, and browser forward cannot restore stale results after changing storage', async ({
  page,
}) => {
  const log = await installSellApiFixtures(page);
  await start(page);
  await assess(page);
  await page.getByRole('button', { name: 'ตรวจหรือแก้คำตอบ', exact: true }).click();
  await page
    .getByRole('button', { name: `แก้ ${profile.questions[1].title}`, exact: true })
    .click();
  const choice = page.getByRole('button', {
    name: profile.questions[1].choices[1].label,
    exact: true,
  });
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ตรวจคำตอบ');
  await page.getByRole('button', { name: 'ดูราคาประเมิน', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('สรุปราคาเครื่องของคุณ');
  expect(log.quotePayloads).toHaveLength(2);
  await page.getByRole('button', { name: 'เปลี่ยนเครื่อง', exact: true }).click();
  await page.getByRole('button', { name: 'iPhone 17 Pro', exact: true }).click();
  await page.getByRole('button', { name: '512 GB', exact: true }).click();
  await expect(page.getByRole('button', { name: 'เครื่องโมเดลไทย', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  expect(log.submitRequests).toHaveLength(0);
});
test('entry and legacy link preserve attribution; enlarged text does not hide the form', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installSellApiFixtures(page);
  await page.goto('/sell?model=iPhone%2017%20Pro&storage=256GB&utm_source=line');
  await page.getByRole('link', { name: 'เริ่มเช็กราคา', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  await page.goto('/buyback/quote?model=iPhone%2017%20Pro&storage=256GB&utm_source=old');
  await expect(page).toHaveURL(/\/sell\/quote\?/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  // ปิดแถบคุกกี้ก่อนขยายตัวอักษร — ที่ตัวอักษร 2 เท่า แถบนี้สูงจนบังตัวเลือก (เป็นของหน้าร้านทั้งเว็บ ไม่ใช่ของขั้นตอนนี้)
  await page
    .getByRole('region', { name: 'การใช้คุกกี้' })
    .getByRole('button', { name: 'ปฏิเสธ', exact: true })
    .click();
  await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
  await noOverflow(page);
  await assess(page);
  await page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน', exact: true }).click();
  await page.getByLabel('ชื่อ-นามสกุล', { exact: true }).fill('ลูกค้าทดสอบ');
  await page.getByLabel('เบอร์โทร (10 หลัก)', { exact: true }).fill('0812345678');
  await expect(page.getByRole('button', { name: 'ส่งข้อมูลขายสด', exact: true })).toBeEnabled();
  await noOverflow(page);
});

test('disabled form controls remain readable and explain what is missing', async ({ page }) => {
  await installSellApiFixtures(page);
  await start(page);
  await assess(page);
  await page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน', exact: true }).click();
  const submit = page.getByRole('button', { name: 'ส่งข้อมูลขายสด', exact: true });
  await expect(submit).toBeDisabled();
  await expect(page.getByText('กรอกชื่อ-นามสกุลก่อนส่งข้อมูล', { exact: true })).toBeVisible();
  const contrast = await submit.evaluate((element) => {
    const style = getComputedStyle(element);
    const opacity = Number(style.opacity);
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const fg = parse(style.color);
    const bg = parse(style.backgroundColor);
    const surface = parse(getComputedStyle(document.body).backgroundColor);
    const background = bg.map((v, i) => v * opacity + (surface[i] ?? 255) * (1 - opacity));
    const foreground = fg.map((v, i) => v * opacity + (surface[i] ?? 255) * (1 - opacity));
    const luminance = (channels: number[]) =>
      channels
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(foreground),
      b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('review discards unconfirmed symptoms and preserves review intent through Forward', async ({
  page,
}) => {
  const log = await installSellApiFixtures(page);
  await start(page);
  await assess(page);
  await page.getByRole('button', { name: 'ตรวจหรือแก้คำตอบ', exact: true }).click();
  const question = profile.questions.find((q) => q.selectType === 'MULTI')!;
  await page.getByRole('button', { name: `แก้ ${question.title}`, exact: true }).click();
  await page.getByRole('button', { name: 'มีอาการผิดปกติ', exact: true }).click();
  const symptom = page.getByRole('checkbox', {
    name: question.key === 'device-origin' ? 'เครื่องโมเดลไทย' : question.choices[0].label,
    exact: true,
  });
  await symptom.check();
  await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ตรวจคำตอบ');
  await expect(page.getByText('ใช้งานได้ปกติทุกอย่าง', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    question.key === 'device-origin' ? 'เครื่องนี้เป็นโมเดลไทยไหม?' : question.title,
  );
  await expect(symptom).toHaveCount(0);
  await page.getByRole('button', { name: 'ใช้งานได้ปกติทุกอย่าง', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ตรวจคำตอบ');
  await page.getByRole('button', { name: 'ดูราคาประเมิน', exact: true }).click();
  await expect(page.getByText('27,500 บาท', { exact: true })).toBeVisible();
  expect(log.quotePayloads.at(-1)?.answers).toEqual(
    expect.arrayContaining([{ questionKey: question.key, choiceIds: [] }]),
  );
});

test('shared device header Back reaches capacity then model', async ({ page }) => {
  await installSellApiFixtures(page);
  await page.goto('/sell/quote?model=iPhone%2017%20Pro&storage=256GB&utm_source=line');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องนี้เป็นโมเดลไทยไหม?');
  await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('เครื่องมีความจุเท่าไร?');
  await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('คุณใช้ iPhone รุ่นไหน?');
  expect(new URL(page.url()).searchParams.get('utm_source')).toBe('line');
});

for (const backWhilePending of [false, true])
  test(`mobile submit failure remains visible and retryable${backWhilePending ? ' after browser Back' : ''}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await installSellApiFixtures(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = true;
    await page.route('**/api/shop/buyback/submit', async (route) => {
      if (!fail) return route.fallback();
      fail = false;
      await pending;
      await route.fulfill({ status: 503, json: { message: 'ส่งไม่สำเร็จ ลองอีกครั้ง' } });
    });
    await start(page);
    await assess(page);
    await page.getByRole('button', { name: 'นัดตรวจเครื่องที่ร้าน', exact: true }).click();
    await page.getByLabel('ชื่อ-นามสกุล', { exact: true }).fill('ลูกค้าทดสอบ');
    await page.getByLabel('เบอร์โทร (10 หลัก)', { exact: true }).fill('0812345678');
    await page.getByText('ข้อมูลเพิ่มเติม (ไม่บังคับ)', { exact: true }).click();
    const submit = page.getByRole('button', { name: 'ส่งข้อมูลขายสด', exact: true });
    const requested = page.waitForRequest('**/api/shop/buyback/submit');
    await submit.click();
    await requested;
    if (backWhilePending) await page.goBack();
    release();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('ส่งไม่สำเร็จ ลองอีกครั้ง');
    await expect(alert).toBeFocused();
    await expect(alert).toBeInViewport();
    await expect(page.getByLabel('ชื่อ-นามสกุล', { exact: true })).toHaveValue('ลูกค้าทดสอบ');
    await expect(page.getByLabel('เบอร์โทร (10 หลัก)', { exact: true })).toHaveValue('0812345678');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/sell\/local-request$/);
  });
