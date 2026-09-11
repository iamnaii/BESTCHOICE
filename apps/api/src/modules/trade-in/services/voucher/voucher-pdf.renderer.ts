import { embeddedDocumentFonts } from '../../../../assets/fonts/document-fonts';

/**
 * VoucherPdfRenderer — Chromium/puppeteer PDF renderer for the Trade-In voucher.
 *
 * Owns the cross-instance shared-browser singleton (static sharedBrowser) so the
 * Chromium process is launched once and reused across all renders + the cached
 * base64 font CSS.
 */
export class VoucherPdfRenderer {
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
    const fontCss = embeddedDocumentFonts();
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
      await page.evaluateHandle('document.fonts.ready');

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
