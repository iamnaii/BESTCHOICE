import { ServiceUnavailableException } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';

jest.mock('puppeteer', () => ({ __esModule: true, default: { launch: jest.fn() } }));
// ฟอนต์ไม่เกี่ยวกับการจัดการ Chromium — ตัดออกให้เทสไม่ต้องอ่านไฟล์ TTF
jest.mock('../../../assets/fonts/document-fonts', () => ({ embeddedDocumentFonts: () => '' }));

const launch = puppeteer.launch as unknown as jest.Mock;

function makePage() {
  return {
    setContent: jest.fn(async () => undefined),
    evaluateHandle: jest.fn(async () => undefined),
    evaluate: jest.fn(async () => undefined),
    pdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])),
    close: jest.fn(async () => undefined),
  };
}

type FakeBrowser = {
  connected: boolean;
  newPage: jest.Mock;
  close: jest.Mock;
};

function makeBrowser(): FakeBrowser {
  return {
    connected: true,
    newPage: jest.fn(async () => makePage()),
    close: jest.fn(async () => undefined),
  };
}

const HTML = '<html><head></head><body>x</body></html>';

describe('AfterSalesPdfRenderer — Chromium ที่ใช้ร่วม', () => {
  let browsers: FakeBrowser[];

  beforeEach(() => {
    browsers = [];
    launch.mockReset();
    launch.mockImplementation(async () => {
      const b = makeBrowser();
      browsers.push(b);
      return b;
    });
  });

  afterEach(async () => {
    await AfterSalesPdfRenderer.closeShared();
  });

  it('สองคำขอพร้อมกันบนคลาสที่ยังไม่มี Chromium → launch ครั้งเดียว', async () => {
    const [a, b] = await Promise.all([
      new AfterSalesPdfRenderer().htmlToPdf(HTML),
      new AfterSalesPdfRenderer().htmlToPdf(HTML),
    ]);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browsers).toHaveLength(1);
    expect(browsers[0].newPage).toHaveBeenCalledTimes(2);
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(Buffer.isBuffer(b)).toBe(true);
  });

  it('Chromium หลุด (connected=false) + สองคำขอพร้อมกัน → relaunch ครั้งเดียว ปิดตัวเก่าไม่เกินหนึ่งครั้ง', async () => {
    await new AfterSalesPdfRenderer().htmlToPdf(HTML);
    expect(launch).toHaveBeenCalledTimes(1);
    const stale = browsers[0];
    stale.connected = false;
    launch.mockClear();

    await Promise.all([
      new AfterSalesPdfRenderer().htmlToPdf(HTML),
      new AfterSalesPdfRenderer().htmlToPdf(HTML),
    ]);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browsers).toHaveLength(2);
    // ผู้ชนะ compare-and-swap คนเดียวปิดตัวเก่า (best-effort) — ไม่มีใครปิดซ้ำ
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(stale.newPage).toHaveBeenCalledTimes(1); // เฉพาะคำขอแรกก่อนหลุด
    expect(browsers[1].newPage).toHaveBeenCalledTimes(2);
  });

  it('closeShared() ปิดตัวที่ติดตั้งอยู่ แล้วคำขอถัดไป launch ใหม่', async () => {
    await new AfterSalesPdfRenderer().htmlToPdf(HTML);
    expect(launch).toHaveBeenCalledTimes(1);

    await AfterSalesPdfRenderer.closeShared();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);

    await new AfterSalesPdfRenderer().htmlToPdf(HTML);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(browsers[1].newPage).toHaveBeenCalledTimes(1);
  });

  it('I5 — 3 คำขอพร้อมกัน → เปิดหน้า (page) พร้อมกันไม่เกิน 2 · ตัวที่ 3 รอคิวแล้วได้ทำต่อเมื่อมีหน้าปิด', async () => {
    let open = 0;
    let maxOpen = 0;
    const gates: (() => void)[] = [];
    launch.mockImplementation(async () => {
      const b = makeBrowser();
      b.newPage = jest.fn(async () => {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        const p = makePage();
        // ค้างหน้าไว้จนเทสปล่อย — ให้เห็นว่ามีกี่หน้าเปิดพร้อมกันจริง
        p.setContent = jest.fn(() => new Promise<undefined>((r) => gates.push(() => r(undefined))));
        p.close = jest.fn(async () => {
          open -= 1;
          return undefined;
        });
        return p;
      });
      browsers.push(b);
      return b;
    });
    const flushUntil = async (cond: () => boolean) => {
      for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setImmediate(r));
    };

    const all = Promise.all([1, 2, 3].map(() => new AfterSalesPdfRenderer().htmlToPdf(HTML)));
    await flushUntil(() => gates.length === 2);
    await flushUntil(() => false); // ให้โอกาสตัวที่ 3 แทรก ถ้าไม่มีคิวจริงมันจะเปิดหน้าที่ 3 ตรงนี้
    expect(open).toBe(2);
    expect(browsers[0].newPage).toHaveBeenCalledTimes(2);

    gates.shift()!(); // ปล่อยหน้าแรก → ปิด → ตัวที่ 3 ได้คิว
    await flushUntil(() => gates.length === 2);
    expect(browsers[0].newPage).toHaveBeenCalledTimes(3);
    expect(open).toBe(2);

    while (gates.length) gates.shift()!();
    await flushUntil(() => gates.length > 0 || open === 0);
    while (gates.length) gates.shift()!();
    const out = await all;
    expect(out).toHaveLength(3);
    expect(maxOpen).toBe(2);
    expect(open).toBe(0);
  });

  it('I5 — หน้าที่ล้ม (newPage/pdf error) ต้องคืนคิวเสมอ ไม่งั้นคำขอถัดไปค้างตลอดกาล', async () => {
    launch.mockImplementation(async () => {
      const b = makeBrowser();
      b.newPage = jest
        .fn()
        .mockRejectedValueOnce(new Error('newPage boom'))
        .mockRejectedValueOnce(new Error('newPage boom'))
        .mockImplementation(async () => {
          const p = makePage();
          p.pdf = jest.fn().mockRejectedValueOnce(new Error('pdf boom'));
          return p;
        });
      browsers.push(b);
      return b;
    });
    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).rejects.toThrow('newPage boom');
    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).rejects.toThrow('newPage boom');
    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).rejects.toThrow('pdf boom');
    // ถ้าสามครั้งข้างบนไม่คืนคิว (2 ช่อง) ครั้งนี้จะค้างจน jest timeout
    browsers[0].newPage.mockImplementation(async () => makePage());
    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).resolves.toBeInstanceOf(Buffer);
  });

  describe('m11 — รอฟอนต์/ย่อรูปนานเกิน 15 วิ → 503 ไทย (ไม่รอ protocol timeout 180 วิ)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    for (const stuck of ['evaluateHandle', 'evaluate'] as const) {
      it(`${stuck === 'evaluateHandle' ? 'document.fonts.ready' : 'window.__afterSalesThumbs'} ไม่เคย resolve`, async () => {
        const page = makePage();
        page[stuck] = jest.fn(() => new Promise<undefined>(() => undefined));
        launch.mockImplementation(async () => {
          const b = makeBrowser();
          b.newPage = jest.fn(async () => page);
          browsers.push(b);
          return b;
        });
        jest.useFakeTimers();

        const run = new AfterSalesPdfRenderer().htmlToPdf(HTML);
        const settled = run.then(
          () => 'resolved',
          (e: unknown) => e,
        );
        await jest.advanceTimersByTimeAsync(14_999);
        expect(page.close).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        const err = await settled;
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        expect((err as ServiceUnavailableException).message).toBe(
          'สร้างเอกสารไม่ทันเวลา กรุณาลองใหม่',
        );
        expect(page.pdf).not.toHaveBeenCalled();
        expect(page.close).toHaveBeenCalledTimes(1);
      });
    }

    it('ทุกการรอเสร็จทัน → ไม่มี timer ค้าง (clearTimeout)', async () => {
      jest.useFakeTimers();
      await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).resolves.toBeInstanceOf(Buffer);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('launch ล้มเหลว → คำขอนั้น error ตามเดิม และคำขอถัดไป launch ใหม่ได้', async () => {
    launch.mockImplementationOnce(async () => {
      throw new Error('no chromium');
    });

    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).rejects.toThrow('no chromium');
    expect(launch).toHaveBeenCalledTimes(1);

    await expect(new AfterSalesPdfRenderer().htmlToPdf(HTML)).resolves.toBeInstanceOf(Buffer);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(browsers).toHaveLength(1);
  });
});
