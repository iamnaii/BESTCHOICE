import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * StepScreenshot — Helper สำหรับถ่าย screenshot ทุก step อัตโนมัติ
 *
 * ใช้ sequential naming: 01-description.png, 02-description.png, ...
 * เก็บไว้ใน e2e/screenshots/{testName}/
 */
export class StepScreenshot {
  private step = 0;
  private dir: string;

  constructor(private page: Page, testName: string) {
    this.dir = path.join(__dirname, '..', 'screenshots', testName);
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * ถ่าย full-page screenshot พร้อม step number อัตโนมัติ
   * @param description - ชื่อ step เช่น 'page-loaded', 'after-submit'
   */
  async capture(description: string): Promise<string> {
    this.step++;
    const filename = `${String(this.step).padStart(2, '0')}-${description}.png`;
    const filepath = path.join(this.dir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true, timeout: 5000 }).catch(() => {
      // Fallback: take viewport-only screenshot if fullPage times out (e.g. fonts not loaded)
      return this.page.screenshot({ path: filepath, fullPage: false, timeout: 5000 });
    });
    return filepath;
  }
}
