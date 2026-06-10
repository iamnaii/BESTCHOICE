import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VoucherPdfRenderer — Chromium/puppeteer PDF renderer for the Trade-In voucher.
 *
 * Owns the cross-instance shared-browser singleton (static sharedBrowser) so the
 * Chromium process is launched once and reused across all renders + the cached
 * base64 font CSS.
 */
export class VoucherPdfRenderer {
  private readonly logger = new Logger(VoucherPdfRenderer.name);

  // ─── Font cache (base64) — โหลด TTF ครั้งเดียว ใช้ทุกครั้ง ──
  private cachedFontCss: string | null | undefined;
  private resolveFontCss(): string | null {
    if (this.cachedFontCss !== undefined) return this.cachedFontCss;
    try {
      const fontPaths = [
        path.join(process.cwd(), 'public', 'fonts'),
        path.join(__dirname, '..', '..', '..', '..', '..', '..', 'public', 'fonts'),
        path.join(process.cwd(), '..', 'web', 'public', 'fonts'),
      ];
      const fontsDir = fontPaths.find((p) =>
        fs.existsSync(path.join(p, 'THSarabunPSK-Regular.ttf')),
      );
      if (!fontsDir) {
        this.cachedFontCss = null;
        return null;
      }
      const reg = path.join(fontsDir, 'THSarabunPSK-Regular.ttf');
      const bold = path.join(fontsDir, 'THSarabunPSK-Bold.ttf');
      let css = '';
      if (fs.existsSync(reg)) {
        css += `@font-face{font-family:'TH Sarabun PSK';src:url(data:font/truetype;base64,${fs
          .readFileSync(reg)
          .toString('base64')}) format('truetype');font-weight:400;font-style:normal;}`;
      }
      if (fs.existsSync(bold)) {
        css += `@font-face{font-family:'TH Sarabun PSK';src:url(data:font/truetype;base64,${fs
          .readFileSync(bold)
          .toString('base64')}) format('truetype');font-weight:700;font-style:normal;}`;
      }
      this.cachedFontCss = css || null;
      return this.cachedFontCss;
    } catch (err) {
      this.logger.warn(`Font preload failed: ${err instanceof Error ? err.message : err}`);
      this.cachedFontCss = null;
      return null;
    }
  }

  // ─── Shared browser (singleton) — ลดเวลา launch Chromium ลง ──
  private static sharedBrowser: Promise<unknown> | null = null;
  private async getBrowser() {
    const puppeteer = await import('puppeteer');
    if (!VoucherPdfRenderer.sharedBrowser) {
      VoucherPdfRenderer.sharedBrowser = puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    try {
      const browser = (await VoucherPdfRenderer.sharedBrowser) as {
        newPage: () => Promise<unknown>;
        connected?: boolean;
        process?: () => unknown;
      };
      if (browser.connected === false || !browser.process?.()) {
        VoucherPdfRenderer.sharedBrowser = puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        return (await VoucherPdfRenderer.sharedBrowser) as {
          newPage: () => Promise<unknown>;
        };
      }
      return browser as { newPage: () => Promise<unknown> };
    } catch {
      VoucherPdfRenderer.sharedBrowser = puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      return (await VoucherPdfRenderer.sharedBrowser) as {
        newPage: () => Promise<unknown>;
      };
    }
  }

  // ─── PDF render (puppeteer) ───────────────────────────────
  async htmlToPdf(html: string): Promise<Buffer> {
    // Inject fonts เข้า <head> ของ HTML ก่อนส่งให้ Chromium
    // (ก่อนหน้านี้ใช้ addStyleTag หลัง setContent — ฟอนต์มาช้า text render ไม่ทัน)
    const fontCss = this.resolveFontCss();
    const htmlWithFonts = fontCss
      ? html.replace('</head>', `<style>${fontCss}</style></head>`)
      : html;

    const browser = await this.getBrowser();
    const page = (await browser.newPage()) as {
      setContent: (html: string, opts: { waitUntil: string; timeout: number }) => Promise<void>;
      evaluateHandle: (fn: string) => Promise<unknown>;
      pdf: (opts: {
        format: string;
        printBackground: boolean;
        preferCSSPageSize: boolean;
      }) => Promise<Uint8Array>;
      close: () => Promise<void>;
    };
    try {
      // domcontentloaded + รอ fonts ready — เร็วกว่า networkidle0 มาก
      // เพราะเนื้อหาเป็น self-contained HTML ไม่มี external network call
      await page.setContent(htmlWithFonts, { waitUntil: 'domcontentloaded', timeout: 15000 });
      try {
        await page.evaluateHandle('document.fonts.ready');
      } catch {
        // fonts API อาจไม่พร้อม — ไม่ block PDF
      }

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
