import { test, expect } from '@playwright/test';
import { backlogFixtures } from './helpers/backlog-fixtures';
import {
  openPromiseFixture,
  savePromise,
  readPromiseFixture,
  readPromiseLogs,
} from './helpers/promise-fixture';

test.describe('Promise supersede — reschedule flow', () => {
  test('reschedule before due — confirm dialog + no broken increment', async ({ page }) => {
    const f = backlogFixtures().promiseSupersede;
    await openPromiseFixture(page, f.id, 'คิววันนี้');
    await savePromise(page, f.id, [{ date: 'อีก 3 วัน', amount: '5000' }], false);
    const before = await readPromiseFixture(page, f.id);
    const original = (await readPromiseLogs(page, f.id)).find(
      (log: { result: string }) => log.result === 'PROMISED',
    );
    expect(original.rescheduleCount).toBe(0);
    await page.getByRole('button', { name: 'นัดชำระ', exact: true }).click();
    await savePromise(page, f.id, [{ date: 'อีก 7 วัน', amount: '5000' }], true);
    const after = await readPromiseFixture(page, f.id);
    const logs = await readPromiseLogs(page, f.id);
    const old = logs.find((log: { id: string }) => log.id === original.id);
    const current = logs.find(
      (log: { result: string; supersededAt: string | null }) =>
        log.result === 'PROMISED' && !log.supersededAt,
    );
    expect(old.supersededAt).toBeTruthy();
    expect(old.brokenAt).toBeNull();
    expect(old.supersededByCallLogId).toBe(current.id);
    expect(current.rescheduleCount).toBe(1);
    expect(current.brokenAt).toBeNull();
    expect(after.brokenPromiseCount).toBe(before.brokenPromiseCount);
    expect(after.slots).toHaveLength(1);
    expect(Number(after.slots[0].settlementAmount)).toBe(5000);
    expect(after.slots[0].settlementDate).not.toBe(before.slots[0].settlementDate);
  });
});
