/**
 * Contract Create Page Object Model
 *
 * Wraps /contracts/create — a multi-step wizard:
 *   Step 0: select product
 *   Step 1: select/create customer
 *   Step 2: plan details (months, down payment)
 *   Step 3: summary + submit
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoWithRetry } from '../helpers/navigation';

export class ContractCreatePage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<boolean> {
    return gotoWithRetry(this.page, '/contracts/create');
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: /สร้างสัญญา/ }).first();
  }

  nextBtn(): Locator {
    return this.page.getByRole('button', { name: /ถัดไป|ต่อไป|ถัดไป/ }).first();
  }

  backBtn(): Locator {
    return this.page.getByRole('button', { name: /ย้อนกลับ|กลับ/ }).first();
  }

  submitBtn(): Locator {
    return this.page.getByRole('button', { name: /สร้างสัญญา|บันทึก|ส่ง/ }).last();
  }

  productSearchInput(): Locator {
    return this.page.getByPlaceholder(/ค้นหาสินค้า|IMEI|รุ่น/i).first();
  }

  firstProductResult(): Locator {
    return this.page.locator('[role="option"], .product-result, .search-result, [class*="cursor-pointer"]').filter({ hasText: /฿|ราคา|iPhone|Galaxy/ }).first();
  }

  customerSearchInput(): Locator {
    return this.page.getByPlaceholder(/ค้นหาลูกค้า|ชื่อลูกค้า|เบอร์โทร|บัตรประชาชน/i).first();
  }

  firstCustomerResult(): Locator {
    return this.page.locator('[role="option"], .customer-result, [class*="cursor-pointer"]').filter({ hasText: /08|09/ }).first();
  }

  downPaymentInput(): Locator {
    return this.page.getByLabel(/เงินดาวน์|ดาวน์/i).first()
      .or(this.page.locator('input[name*="downPayment"], input[name*="down"]').first());
  }

  monthsInput(): Locator {
    return this.page.getByLabel(/จำนวนงวด|เดือน/i).first()
      .or(this.page.locator('input[name*="months"], select[name*="months"]').first());
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }

  async waitForLoaded(): Promise<boolean> {
    return this.heading()
      .isVisible({ timeout: 10000 })
      .catch(() => false);
  }
}
