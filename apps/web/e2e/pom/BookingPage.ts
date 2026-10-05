/**
 * Bookings Page Object Model
 *
 * Wraps /bookings — list + create dialog. Detail opens a dialog with
 * lifecycle actions: pay deposit, cancel, convert.
 */
import { Page, Locator, expect } from '@playwright/test';
import { gotoWithRetry } from '../helpers/navigation';

export class BookingPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<boolean> {
    return gotoWithRetry(this.page, '/bookings');
  }

  heading(): Locator {
    return this.page.getByRole('heading', { name: /การจอง.*มัดจำ/ }).first();
  }

  createBtn(): Locator {
    return this.page.getByRole('button', { name: /สร้างใบจอง/ }).first();
  }

  dialogTitle(): Locator {
    return this.page.getByRole('heading', { name: /สร้างใบจอง/ }).first();
  }

  statusFilterTrigger(): Locator {
    return this.page.getByRole('combobox', { name: 'สถานะใบจอง' });
  }

  /**
   * รอจนหน้าตัดสินสถานะ: หน้าว่างครั้งแรก ('empty') หรือรายการ + การ์ด KPI ('list')
   * — หัวหน้าแสดงก่อน summary โหลดเสร็จ จึงห้ามแยกทางด้วย isVisible() ที่ไม่รอ
   */
  async waitForState(): Promise<'empty' | 'list'> {
    const empty = this.page.getByRole('heading', { name: 'ยังไม่มีใบจอง' });
    const list = this.page.getByRole('group', { name: 'สรุปใบจอง' });
    await expect(empty.or(list)).toBeVisible({ timeout: 15000 });
    return (await empty.isVisible()) ? 'empty' : 'list';
  }

  /** Generic "select option by text" — works for any combobox after click() */
  optionByText(text: string | RegExp): Locator {
    return this.page
      .getByRole('option', { name: text })
      .first()
      .or(this.page.getByText(text).first());
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }
}
