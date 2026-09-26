import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Browser } from 'puppeteer';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/** Cloud Run 2 GiB — แต่ละหน้าถอดรหัสรูปมือถือได้หลายร้อย MB ⇒ เปิดหน้าพร้อมกันไม่เกินนี้ ที่เหลือเข้าคิว */
const MAX_CONCURRENT_PAGES = 2;
/** เว็บเลิกรอที่ 120 วิ ส่วน protocol timeout ของ puppeteer 180 วิ ⇒ รอฟอนต์/ย่อรูปแต่ละช่วงไม่เกินนี้ */
const WAIT_TIMEOUT_MS = 15_000;
export const RENDER_TIMEOUT_MSG = 'สร้างเอกสารไม่ทันเวลา กรุณาลองใหม่';

// semaphore ระดับโมดูล (ครอบทุก instance) — คืนช่องแบบส่งต่อตรงให้คิวถัดไป ไม่ปล่อยให้แย่งกัน
let activePages = 0;
const pageQueue: (() => void)[] = [];

function acquirePageSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => pageQueue.push(resolve));
}

function releasePageSlot(): void {
  const next = pageQueue.shift();
  if (next) next();
  else activePages -= 1;
}

async function withWaitTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ServiceUnavailableException(RENDER_TIMEOUT_MSG)),
      WAIT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML → PDF ของใบรับฝากเครื่อง/ใบส่งมอบ — Chromium ตัวเดียวใช้ร่วมทุกคำขอ (แบบ VoucherPdfRenderer)
 * ต่างจาก renderer อื่นตรงที่ **รอสคริปต์ย่อรูป** (`window.__afterSalesThumbs` จาก
 * after-sales-doc-html.ts) ก่อน page.pdf() — ไม่งั้น PDF ฝังรูปมือถือเต็มไฟล์
 */
@Injectable()
export class AfterSalesPdfRenderer {
  private static shared: Promise<Browser> | null = null;

  private static launch(): Promise<Browser> {
    return import('puppeteer').then((p) => p.default.launch({ headless: true, args: LAUNCH_ARGS }));
  }

  /**
   * ตรวจและติดตั้ง promise ของ launch ในจังหวะ synchronous เดียวกัน — คำขอที่มาพร้อมกันจึงรอ
   * Chromium ตัวเดียวกัน ไม่ launch ซ้อนแล้วทิ้งตัวแรกค้าง (เดิมตั้ง `shared` หลัง `await import`)
   */
  private async browser(): Promise<Browser> {
    const pending = AfterSalesPdfRenderer.shared;
    if (!pending) {
      const launched = AfterSalesPdfRenderer.launch();
      AfterSalesPdfRenderer.shared = launched;
      return launched;
    }
    const current = await pending.catch(() => null);
    if (current?.connected) return current;
    // หลุดหรือ launch ล้ม: compare-and-swap — เปลี่ยนเฉพาะเมื่อยังเป็นตัวเดิมที่เรารอ
    // ถ้าคนอื่นติดตั้งตัวใหม่ไปแล้วก็ใช้ตัวนั้น (relaunch ครั้งเดียวต่อการหลุดหนึ่งครั้ง)
    if (AfterSalesPdfRenderer.shared === pending) {
      AfterSalesPdfRenderer.shared = AfterSalesPdfRenderer.launch();
      void current?.close().catch(() => undefined);
    }
    // closeShared() ล้างทิ้งระหว่างรอ → เริ่มใหม่
    return AfterSalesPdfRenderer.shared ?? this.browser();
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const fontCss = embeddedDocumentFonts();
    const withFonts = fontCss ? html.replace('</head>', `<style>${fontCss}</style></head>`) : html;
    await acquirePageSlot();
    try {
      const page = await (await this.browser()).newPage();
      try {
        await page.setContent(withFonts, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await withWaitTimeout(page.evaluateHandle('document.fonts.ready'));
        await withWaitTimeout(page.evaluate('window.__afterSalesThumbs || null'));
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        });
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      releasePageSlot();
    }
  }

  /** ปิด Chromium ที่ใช้ร่วม — สำหรับ smoke test ให้ jest จบได้ */
  static async closeShared(): Promise<void> {
    // ถอดออกก่อน await — ตัวที่ถูก relaunch ระหว่างรอจะไม่ถูกลบทิ้งโดยไม่ได้ปิด
    const pending = AfterSalesPdfRenderer.shared;
    AfterSalesPdfRenderer.shared = null;
    const current = pending ? await pending.catch(() => null) : null;
    await current?.close().catch(() => undefined);
  }
}
