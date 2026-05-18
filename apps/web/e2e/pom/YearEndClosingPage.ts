/**
 * Year-End Closing Page Object Model
 *
 * Wraps /finance/year-end-closing — Phase 3 SP1 page that closes revenue +
 * expense into Income Summary (39-9999) then transfers to retained earnings.
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoWithRetry } from '../helpers/navigation';

export class YearEndClosingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<boolean> {
    return gotoWithRetry(this.page, '/finance/year-end-closing');
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: /ปิดบัญชีสิ้นปี/ }).first();
  }

  /** Native <select> for the year dropdown */
  yearSelect(): Locator {
    return this.page.locator('#year-input');
  }

  previewBtn(): Locator {
    return this.page.getByRole('button', { name: /ดูตัวอย่างการปิดบัญชี|กำลังคำนวณ/ }).first();
  }

  /** The destructive "Close year X" button */
  closeYearBtn(): Locator {
    return this.page.getByRole('button', { name: /ปิดบัญชีปี/ }).last();
  }

  /** ConfirmDialog confirm — the destructive variant */
  confirmDialogConfirmBtn(): Locator {
    return this.page
      .getByRole('dialog')
      .getByRole('button', { name: /ปิดบัญชีปี|ยืนยัน/ })
      .first();
  }

  /** "Already closed" banner */
  alreadyClosedBanner(): Locator {
    return this.page.getByText(/ปิดบัญชีไปแล้ว|ปิดไปแล้วเมื่อ/).first();
  }

  /** Open-months error banner */
  openMonthsBanner(): Locator {
    return this.page.getByText(/ต้องปิดงวดบัญชีรายเดือนก่อน/).first();
  }

  /** Reverse button (OWNER only) */
  reverseBtn(): Locator {
    return this.page.getByRole('button', { name: /กลับรายการ/ }).first();
  }

  async setYear(year: number): Promise<void> {
    const sel = this.yearSelect();
    if (await sel.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try select dropdown first
      const isSelect = await sel.evaluate((el) => el.tagName.toLowerCase() === 'select');
      if (isSelect) {
        await sel.selectOption({ value: String(year) });
      } else {
        await sel.fill(String(year));
      }
    }
  }

  async clickPreview(): Promise<void> {
    await this.previewBtn().click();
    // Wait for preview to load — net-income card visible OR alreadyClosed banner
    await Promise.race([
      this.page.getByText(/กำไรสุทธิ|ขาดทุนสุทธิ/).first().waitFor({ timeout: 15000 }).catch(() => null),
      this.alreadyClosedBanner().waitFor({ timeout: 15000 }).catch(() => null),
      this.openMonthsBanner().waitFor({ timeout: 15000 }).catch(() => null),
    ]);
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }
}
