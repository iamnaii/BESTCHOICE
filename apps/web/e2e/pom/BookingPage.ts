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
    return this.page.getByRole('combobox').first();
  }

  /** Generic "select option by text" — works for any combobox after click() */
  optionByText(text: string | RegExp): Locator {
    return this.page.getByRole('option', { name: text }).first()
      .or(this.page.getByText(text).first());
  }

  async assertNoAppError(): Promise<void> {
    await expect(this.page.locator('body')).not.toContainText('เกิดข้อผิดพลาด');
  }
}
