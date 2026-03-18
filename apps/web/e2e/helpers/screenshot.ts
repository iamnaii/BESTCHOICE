import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

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
    await this.page.screenshot({ path: filepath, fullPage: true });
    return filepath;
  }
}
