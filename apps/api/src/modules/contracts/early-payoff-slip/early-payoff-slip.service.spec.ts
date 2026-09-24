import { BadRequestException } from '@nestjs/common';
import { EarlyPayoffSlipService } from './early-payoff-slip.service';

/**
 * ปิดสัญญาด้วยสลิป — ขั้น verify (อัปโหลด → OCR → 5 ข้อ → ตั๋ว) และ confirm (ตั๋ว → earlyPayoff ทาง slipMatch)
 * OCR/ที่เก็บไฟล์/ยอดปิด mock ทั้งหมด — กติกา 5 ข้อทดสอบใน slip-checks.spec
 */
describe('EarlyPayoffSlipService', () => {
  const file = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]),
      mimetype: 'image/jpeg',
      size: 15,
      originalname: 'slip.jpg',
      ...over,
    }) as Express.Multer.File;

  const goodReading = {
    isSlip: true,
    amount: 18135.85,
    refNo: '2026092318425510',
    bankName: 'KBANK',
    date: '2026-09-23',
    time: '14:32',
    toAccount: '203-1-16520-5',
    confidence: 0.97,
  };

  function build(
    over: {
      reading?: unknown;
      ocrThrows?: boolean;
      reused?: boolean;
      totalPayoff?: number;
    } = {},
  ) {
    const prisma = {
      slipFingerprint: {
        findUnique: jest.fn().mockResolvedValue(over.reused ? { id: 'fp-1' } : null),
      },
    };
    const storage = {
      upload: jest.fn().mockResolvedValue('key'),
      getPublicUrl: jest.fn((key: string) => `https://storage.example/bucket/${key}`),
    };
    const vision = {
      extractSlip: over.ocrThrows
        ? jest.fn().mockRejectedValue(new Error('anthropic down'))
        : jest.fn().mockResolvedValue(over.reading === undefined ? goodReading : over.reading),
    };
    const financeConfig = {
      isCompanyBankAccount: jest.fn(
        (a: string | null | undefined) => (a ?? '').replace(/\D/g, '') === '2031165205',
      ),
    };
    const contractPayment = {
      getEarlyPayoffQuote: jest
        .fn()
        .mockResolvedValue({ totalPayoff: over.totalPayoff ?? 18135.85 }),
      earlyPayoff: jest.fn().mockResolvedValue({ status: 'EARLY_PAYOFF' }),
    };
    const config = {
      get: jest.fn((k: string) => (k === 'JWT_SECRET' ? 'test-secret' : undefined)),
    };
    const service = new EarlyPayoffSlipService(
      prisma as never,
      storage as never,
      vision as never,
      financeConfig as never,
      contractPayment as never,
      config as never,
    );
    return { service, prisma, storage, vision, financeConfig, contractPayment };
  }

  it('สลิปตรงครบ 5 ข้อ → matched + ตั๋ว · อัปโหลดใต้ early-payoff-slips/<contract> · ยอดปิดคิดด้วยส่วนลดที่ส่งมา', async () => {
    const { service, storage, contractPayment, vision } = build();
    const res = await service.verify('ct-1', file(), '50', 'u-1');
    expect(res.engine).toBe('OCR');
    expect(res.available).toBe(true);
    expect(res.matched).toBe(true);
    expect(res.checks.every((c) => c.ok)).toBe(true);
    expect(res.expectedAmount).toBe(18135.85);
    expect(res.discountPct).toBe(50);
    expect(res.paymentDate).toBe('2026-09-23');
    expect(res.ticket).toEqual(expect.any(String));
    expect(res.slipUrl).toMatch(/^https:\/\/storage\.example\/bucket\/early-payoff-slips\/ct-1\//);
    expect(storage.upload.mock.calls[0][0]).toMatch(/^early-payoff-slips\/ct-1\/.*\.jpg$/);
    expect(contractPayment.getEarlyPayoffQuote).toHaveBeenCalledWith('ct-1', 50, '11-1201');
    expect(vision.extractSlip).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
  });

  it('ยอดไม่ตรง → matched=false ไม่มีตั๋ว แต่ยังคืน slipUrl ให้แนบไปกับคำขออนุมัติ', async () => {
    const { service } = build({ reading: { ...goodReading, amount: 18000 } });
    const res = await service.verify('ct-1', file(), undefined, 'u-1');
    expect(res.matched).toBe(false);
    expect(res.ticket).toBeNull();
    expect(res.discountPct).toBe(50); // default
    expect(res.checks.find((c) => c.code === 'AMOUNT_MATCH')?.ok).toBe(false);
    expect(res.slipUrl).toContain('early-payoff-slips/ct-1/');
  });

  it('OCR ล้ม/ไม่พร้อม → available=false ทุกข้อไม่ผ่าน ไม่โยน (หน้าจอพาไปขออนุมัติ)', async () => {
    for (const s of [build({ ocrThrows: true }), build({ reading: null })]) {
      const res = await s.service.verify('ct-1', file(), '50', 'u-1');
      expect(res.available).toBe(false);
      expect(res.matched).toBe(false);
      expect(res.ticket).toBeNull();
      expect(res.reading).toBeNull();
    }
  });

  it('สลิปเคยใช้ (ลายนิ้วมือชน) → NOT_REUSED ไม่ผ่าน', async () => {
    const { service, prisma } = build({ reused: true });
    const res = await service.verify('ct-1', file(), '50', 'u-1');
    expect(res.matched).toBe(false);
    expect(res.checks.find((c) => c.code === 'NOT_REUSED')?.ok).toBe(false);
    expect(prisma.slipFingerprint.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hash: expect.any(String) } }),
    );
  });

  it('ไฟล์ไม่ใช่รูป / ส่วนลดนอกช่วง → 400 ก่อนอัปโหลด', async () => {
    const { service, storage } = build();
    await expect(
      service.verify('ct-1', file({ mimetype: 'application/pdf' }), '50', 'u-1'),
    ).rejects.toThrow(BadRequestException);
    await expect(service.verify('ct-1', file(), '120', 'u-1')).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  describe('confirm — ตั๋ว', () => {
    it('ตั๋วที่ verify ออกให้ → earlyPayoff ทาง slipMatch ด้วย dto จากสลิป (กสิกร · โอน · วันที่/เลขอ้างอิงจากสลิป)', async () => {
      const { service, contractPayment } = build();
      const { ticket } = await service.verify('ct-1', file(), '40', 'u-1');
      await service.confirm('ct-1', 'u-1', { ticket: ticket!, notes: 'โอนจากบัญชีญาติ' });
      expect(contractPayment.earlyPayoff).toHaveBeenCalledWith(
        'ct-1',
        'u-1',
        expect.objectContaining({
          paymentMethod: 'BANK_TRANSFER',
          discountPct: 40,
          depositAccountCode: '11-1201',
          paymentDate: '2026-09-23',
          referenceNo: '2026092318425510',
          notes: 'โอนจากบัญชีญาติ',
          slipUrl: expect.stringContaining('early-payoff-slips/ct-1/'),
        }),
        undefined,
        expect.objectContaining({
          amount: 18135.85,
          refNo: '2026092318425510',
          bankName: 'KBANK',
          date: '2026-09-23',
          confidence: 0.97,
          hash: expect.any(String),
          imageKey: expect.stringContaining('early-payoff-slips/ct-1/'),
        }),
      );
    });

    it('ตั๋วถูกแก้ / คนละสัญญา / คนละผู้กด / หมดอายุ → 400 และไม่แตะ earlyPayoff', async () => {
      const { service, contractPayment } = build();
      const { ticket } = await service.verify('ct-1', file(), '50', 'u-1');
      const [body, sig] = ticket!.split('.');
      const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), amount: 1 })).toString('base64url')}.${sig}`;
      await expect(service.confirm('ct-1', 'u-1', { ticket: tampered })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirm('ct-2', 'u-1', { ticket: ticket! })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirm('ct-1', 'u-2', { ticket: ticket! })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.confirm('ct-1', 'u-1', { ticket: 'garbage' })).rejects.toThrow(
        BadRequestException,
      );
      const realNow = Date.now;
      Date.now = () => realNow() + 16 * 60 * 1000;
      try {
        await expect(service.confirm('ct-1', 'u-1', { ticket: ticket! })).rejects.toThrow(
          /หมดอายุ/,
        );
      } finally {
        Date.now = realNow;
      }
      expect(contractPayment.earlyPayoff).not.toHaveBeenCalled();
    });
  });
});
