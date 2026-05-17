import { Test, TestingModule } from '@nestjs/testing';
import { TemplateCategoriesService } from './template-categories.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('TemplateCategoriesService (D1.2.4.5)', () => {
  let service: TemplateCategoriesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      templateCategory: {
        findMany: jest.fn(),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateCategoriesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(TemplateCategoriesService);
  });

  it('returns active categories ordered by name', async () => {
    prisma.templateCategory.findMany.mockResolvedValue([
      { id: 'c1', name: 'ค่าเช่า', description: null },
      { id: 'c2', name: 'เงินเดือน', description: 'เงินเดือนพนักงาน' },
    ]);

    const result = await service.list();

    expect(prisma.templateCategory.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true },
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('ค่าเช่า');
  });

  it('returns an empty array when no categories exist', async () => {
    prisma.templateCategory.findMany.mockResolvedValue([]);
    const result = await service.list();
    expect(result).toEqual([]);
  });

  it('soft-deleted rows are filtered out (deletedAt: null in where)', async () => {
    prisma.templateCategory.findMany.mockResolvedValue([
      { id: 'c1', name: 'รายจ่ายทั่วไป', description: null },
    ]);
    await service.list();
    const callArg = prisma.templateCategory.findMany.mock.calls[0][0];
    expect(callArg.where).toEqual({ deletedAt: null });
  });

  it('selects only the public fields (id/name/description) — no audit timestamps leak', async () => {
    prisma.templateCategory.findMany.mockResolvedValue([]);
    await service.list();
    const callArg = prisma.templateCategory.findMany.mock.calls[0][0];
    expect(callArg.select).toEqual({
      id: true,
      name: true,
      description: true,
    });
  });
});
