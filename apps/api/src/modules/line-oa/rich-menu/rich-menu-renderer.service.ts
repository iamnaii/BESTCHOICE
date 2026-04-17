import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class RichMenuRendererService {
  private readonly logger = new Logger(RichMenuRendererService.name);

  /**
   * Render a rich-menu HTML template to a 2500×1686 PNG buffer.
   *
   * Uses a headless browser so Thai text shaping, web fonts, and CSS grid all
   * work as they do in production — far more reliable than node-canvas for Thai.
   */
  async render(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: 2500,
        height: 1686,
        deviceScaleFactor: 1,
      });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.evaluateHandle('document.fonts.ready');

      const buffer = await page.screenshot({
        type: 'png',
        omitBackground: false,
        clip: { x: 0, y: 0, width: 2500, height: 1686 },
      });
      this.logger.log(`Rendered rich-menu image: ${buffer.length} bytes`);
      return Buffer.from(buffer);
    } finally {
      await browser.close();
    }
  }
}
