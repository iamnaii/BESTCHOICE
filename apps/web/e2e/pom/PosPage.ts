/**
 * POS Page Object Model
 *
 * Wraps the /pos page. Keeps spec files focused on intent, not selectors.
 * Selectors are intentionally permissive (regex + first()) because the real
 * page has multiple sale-type-switched layouts.
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoWithRetry } from '../helpers/navigation';

export class PosPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<boolean> {
    return gotoWithRetry(this.page, '/pos');
  }

  heading(): Locator {
    return this.page.getByText('POS').first();
  }

  productSearchInput(): Locator {
    return this.page.getByPlaceholder(/ค้นหาสินค้า|IMEI|ชื่อ|รุ่น|สินค้า/i).first();
  }

  customerSearchInput(): Locator {
    return this.page.getByPlaceholder(/ค้นหาลูกค้า|ชื่อ|เบอร์|บัตร|ลูกค้า/i).first();
  }

  /** CASH tile (default selected). */
  cashSaleTile(): Locator {
    return this.page.getByText(/เงินสด/).first();
  }

  externalFinanceTile(): Locator {
    return this.page.getByText(/ไฟแนนซ์|ภายนอก/).first();
  }

  /** First clickable product result row */
  firstProductResult(): Locator {
    return this.page
      .locator('[role="option"], .product-result, .search-result')
      .first()
      .or(this.page.locator('[class*="cursor-pointer"]').filter({ hasText: /฿|ราคา/ }).first());
  }

  /** First clickable customer result */
  firstCustomerResult(): Locator {
    return this.page
      .locator('[role="option"], .customer-result, .search-result')
      .first()
      .or(this.page.locator('[class*="cursor-pointer"]').filter({ hasText: /08|09/ }).first());
  }

  /** Main "confirm sale" / "ยืนยันการขาย" button (in main content, not sidebar) */
  confirmSaleBtn(): Locator {
    const main = this.page.locator('main, .main-content, [class*="content"]').first();
    return main
      .getByRole('button', { name: /ยืนยันการขาย|บันทึกการขาย|ชำระเงิน/ })
      .first();
  }

  /** Toast notifications */
  toast(): Locator {
    return this.page.locator('[data-sonner-toast]').first();
  }

  async selectCash(): Promise<void> {
    const tile = this.cashSaleTile();
    if (await tile.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tile.click();
    }
  }

  async searchProduct(query: string): Promise<void> {
    const input = this.productSearchInput();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(query);
  }

  async searchCustomer(query: string): Promise<void> {
    const input = this.customerSearchInput();
    await expect(input).toBeVisible({ timeout: 10000 });
    await input.fill(query);
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }
}
