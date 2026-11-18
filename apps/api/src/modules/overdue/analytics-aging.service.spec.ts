import { AnalyticsAgingService } from './analytics-aging.service';
import { renderSqlCall } from '../../utils/__tests__/raw-sql-call';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

describe('AnalyticsAgingService', () => {
  let service: AnalyticsAgingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsAgingService(mockPrisma as never);
  });
  afterEach(() => jest.useRealTimers());

  it('returns all 5 buckets even when DB returns nothing', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.bucket)).toEqual(['1-7', '8-30', '31-60', '61-90', '90+']);
    expect(result.every((r) => r.count === 0 && r.outstanding === 0)).toBe(true);
  });

  it('maps DB rows into the bucket order', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { bucket: '8-30', cnt: BigInt(3), outstanding: '4500.50' },
      { bucket: '90+', cnt: BigInt(1), outstanding: '12000' },
    ]);
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result.find((r) => r.bucket === '8-30')).toEqual({
      bucket: '8-30',
      count: 3,
      outstanding: 4500.5,
    });
    expect(result.find((r) => r.bucket === '90+')).toEqual({
      bucket: '90+',
      count: 1,
      outstanding: 12000,
    });
    expect(result.find((r) => r.bucket === '1-7')?.count).toBe(0);
  });

  it('caches result on second call (same scope)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('separate cache key per branch scope (BRANCH_MANAGER different branch = miss)', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b1' });
    await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b2' });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('returns zero buckets on DB error (no throw)', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('boom'));
    const result = await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });
    expect(result).toHaveLength(5);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  /**
   * อายุหนี้ = วันนี้ตามปฏิทินไทย − วันครบกำหนดตามปฏิทินไทย (2026-11-18)
   * due_date เก็บเที่ยงคืนไทย (= 17:00Z ของวันก่อน) ⇒ เดิม due_date::date ได้วันก่อนวันครบกำหนด อายุเกินจริง 1 วัน
   * (งวดที่เลยกำหนดมา 7 วันถูกนับเป็น 8 วัน → ตกไปช่อง 8-30) และ CURRENT_DATE ตาม TZ ของ session ฐานข้อมูล
   */
  describe('นับอายุหนี้ตามวันปฏิทินไทย', () => {
    beforeEach(() => mockPrisma.$queryRaw.mockResolvedValue([]));

    it('วันนี้ส่งเป็นพารามิเตอร์วันไทย และวันครบกำหนดแปลงเป็นวันไทยก่อนลบ', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T18:30:00.000Z')); // 2026-11-19 01:30 น. ไทย (UTC ยังเป็นวันที่ 18)
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      const { text, values } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain("?::date - ((oldest_due AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date AS days");
      expect(text).not.toContain('CURRENT_DATE');
      expect(text).not.toContain('oldest_due::date');
      expect(values).toEqual(['2026-11-19']);
    });

    it('ก่อนเที่ยงคืนไทยหนึ่งมิลลิวินาที ยังเป็นวันเดิม', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T16:59:59.999Z')); // 2026-11-18 23:59:59.999 น. ไทย
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      expect(renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]).values).toEqual(['2026-11-18']);
    });

    it('ผู้จัดการสาขา: กรองสาขาเป็นพารามิเตอร์ (ไม่ต่อสตริง) ก่อนพารามิเตอร์วันนี้', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-18T05:00:00.000Z'));
      await service.getAgingBuckets({ userRole: 'BRANCH_MANAGER', userBranchId: 'b1' });

      const { text, values } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain('AND c.branch_id = ?');
      expect(values).toEqual(['b1', '2026-11-18']);
    });

    it('เกณฑ์ช่องอายุหนี้คงเดิม (1-7 · 8-30 · 31-60 · 61-90 · 90+)', async () => {
      await service.getAgingBuckets({ userRole: 'OWNER', userBranchId: null });

      const { text } = renderSqlCall(mockPrisma.$queryRaw.mock.calls[0]);
      expect(text).toContain("WHEN days BETWEEN 1 AND 7 THEN '1-7'");
      expect(text).toContain("WHEN days BETWEEN 8 AND 30 THEN '8-30'");
      expect(text).toContain("WHEN days BETWEEN 31 AND 60 THEN '31-60'");
      expect(text).toContain("WHEN days BETWEEN 61 AND 90 THEN '61-90'");
      expect(text).toContain("WHEN days > 90 THEN '90+'");
    });
  });
});
