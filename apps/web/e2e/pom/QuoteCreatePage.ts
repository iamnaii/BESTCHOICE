/**
 * Quotes Page Object Model
 *
 * Wraps /quotes — list page with embedded "Create" dialog (no separate /new route).
 * Detail flows happen inside a modal opened by clicking a row.
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoWithRetry } from '../helpers/navigation';

export class QuoteCreatePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<boolean> {
    return gotoWithRetry(this.page, '/quotes');
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: /ใบเสนอราคา/ }).first();
  }

  createBtn(): Locator {
    return this.page.getByRole('button', { name: /สร้างใบเสนอราคา/ }).first();
  }

  /** First row in the list table */
  firstQuoteRow(): Locator {
    return this.page.locator('table tbody tr').first();
  }

  openFirstQuoteBtn(): Locator {
    return this.page.locator('table tbody tr').first().getByRole('button', { name: /เปิด/ });
  }

  searchInput(): Locator {
    return this.page.getByPlaceholder(/เลขที่|ชื่อลูกค้า/i).first();
  }

  /* ─── Create dialog selectors ─── */

  dialogTitle(): Locator {
    return this.page.getByRole('heading', { name: /สร้างใบเสนอราคา/ }).first();
  }

  /** Inside dialog: customer combobox */
  customerSelect(): Locator {
    return this.page.getByRole('combobox', { name: /ลูกค้า/ }).first()
      .or(this.page.locator('select[name*="customer"], [role="combobox"]').first());
  }

  /** "บันทึก" / submit inside dialog */
  saveDialogBtn(): Locator {
    return this.page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /บันทึก|สร้าง|ยืนยัน/ })
      .first();
  }

  /* ─── Detail dialog selectors ─── */

  sendBtn(): Locator {
    return this.page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /ส่งให้ลูกค้า|ส่ง/ })
      .first();
  }

  acceptBtn(): Locator {
    return this.page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /ยอมรับ/ })
      .first();
  }

  rejectBtn(): Locator {
    return this.page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /ปฏิเสธ/ })
      .first();
  }

  convertBtn(): Locator {
    return this.page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /แปลงเป็นการขาย|แปลง/ })
      .first();
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }
}
