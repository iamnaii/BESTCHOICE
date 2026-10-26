import { test, expect } from '@playwright/test';
import { backlogFixtures } from './helpers/backlog-fixtures';
import { openPromiseFixture, savePromise, readPromiseFixture } from './helpers/promise-fixture';

test.describe('Promise lifecycle — happy path (3 slots)', () => {
  test('promise with 3 slots — record + see cycle banner + slot count', async ({ page }) => {
    const f = backlogFixtures().promiseHappy;
    const card = await openPromiseFixture(page, f.id, 'นัดชำระ');
    const dates = await savePromise(
      page,
      f.id,
      [
        { date: 'อีก 3 วัน', amount: '1000' },
        { date: 'อีก 7 วัน', amount: '1500' },
        { date: 'อีก 15 วัน', amount: '1500' },
      ],
      true,
    );
    const saved = await readPromiseFixture(page, f.id);
    expect(saved.slots).toHaveLength(3);
    expect(
      saved.slots.map((s: { settlementAmount: string }) => Number(s.settlementAmount)),
    ).toEqual([1000, 1500, 1500]);
    expect(
      saved.slots.map((s: { settlementDate: string }) => s.settlementDate.slice(0, 10)),
    ).toEqual(dates);
    expect(new Set(dates).size).toBe(3);
    expect(saved.cycleDeadline).toBeTruthy();
    for (const slot of saved.slots)
      expect(new Date(slot.settlementDate).getTime()).toBeLessThanOrEqual(
        new Date(saved.cycleDeadline).getTime(),
      );
    await expect(card).toBeVisible();
    await expect(card.locator('..')).toContainText('เพดานรอบ');
  });
});
