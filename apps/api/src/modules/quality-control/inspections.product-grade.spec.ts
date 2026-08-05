import { Test } from '@nestjs/testing';
import { InspectionsService } from './inspections.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsOnlineListingService } from '../products/products-online-listing.service';

describe('InspectionsService — เขียนเกรดลง Product (B0)', () => {
  let service: InspectionsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onlineListing: any;

  const inspection = {
    id: 'i1',
    isCompleted: false,
    products: [{ id: 'p1' }, { id: 'p2' }],
    template: { items: [] },
    results: [],
  };

  beforeEach(async () => {
    prisma = {
      inspection: {
        findUnique: jest.fn().mockResolvedValue(inspection),
        update: jest.fn().mockResolvedValue({ id: 'i1' }),
      },
      inspectionResult: { findMany: jest.fn().mockResolvedValue([]) },
      // calculateGrade อ่าน grade_a/b/c_threshold จาก SystemConfig — ไม่ mock = TypeError
      systemConfig: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
        // autoPromoteQcPhotos อ่าน gallery ปัจจุบันก่อนดันรูป
        findUnique: jest.fn().mockResolvedValue({ gallery: [] }),
      },
    };
    onlineListing = { promotePhoto: jest.fn().mockResolvedValue({ gallery: ['u'] }) };
    const module = await Test.createTestingModule({
      providers: [
        InspectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProductsOnlineListingService, useValue: onlineListing },
      ],
    }).compile();
    service = module.get(InspectionsService);
  });

  it('completeInspection: เขียน conditionGrade ลงทุกเครื่องที่ผูกอยู่', async () => {
    // results ว่าง → totalWeight 0 → percentage 0 → เกรด 'D' (ดู calculateGrade :256-266)
    await service.completeInspection('i1');
    const gradeWrites = prisma.product.update.mock.calls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].data.conditionGrade !== undefined,
    );
    expect(gradeWrites).toHaveLength(2);
    expect(gradeWrites[0][0].data.status).toBe('QC_PENDING');
    expect(gradeWrites[0][0].data.conditionGrade).toBe('D');
  });

  it('overrideGrade: อัปเดตเกรดเครื่องตาม dto.grade ด้วย', async () => {
    prisma.inspection.findUnique.mockResolvedValue({ ...inspection, isCompleted: true });
    await service.overrideGrade('i1', { grade: 'C', reason: 'จอมีรอย' });
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conditionGrade: 'C' }) }),
    );
    expect(prisma.product.update).toHaveBeenCalledTimes(2);
    // override เกิดหลัง complete เสมอ — รูปถูกดันไปแล้ว ห้ามดันซ้ำ
    expect(onlineListing.promotePhoto).not.toHaveBeenCalled();
  });

  it('completeInspection: gallery ว่าง → ดันรูป front + back จาก QC ขึ้นเว็บให้เอง', async () => {
    await service.completeInspection('i1');
    // 2 เครื่อง × 2 มุม
    expect(onlineListing.promotePhoto).toHaveBeenCalledTimes(4);
    expect(onlineListing.promotePhoto).toHaveBeenCalledWith('p1', {
      source: 'ANGLE',
      angle: 'front',
    });
  });

  it('completeInspection: มีรูปขึ้นเว็บอยู่แล้ว → ไม่แตะ gallery (คนเลือกไว้เอง)', async () => {
    prisma.product.findUnique.mockResolvedValue({ gallery: ['https://cdn/x.jpg'] });
    await service.completeInspection('i1');
    expect(onlineListing.promotePhoto).not.toHaveBeenCalled();
  });

  it('completeInspection: promotePhoto ล้ม (ไม่มีรูปมุมนั้น) → ปิดใบตรวจได้ตามปกติ', async () => {
    onlineListing.promotePhoto.mockRejectedValue(new Error('ไม่พบรูปที่เลือก'));
    await expect(service.completeInspection('i1')).resolves.toBeDefined();
    expect(prisma.inspection.update).toHaveBeenCalled();
  });
});
