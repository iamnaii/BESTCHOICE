import { Test, TestingModule } from '@nestjs/testing';
import { ShopReviewsService } from './shop-reviews.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * listRecent powers the web-shop home page testimonials (replaces the old
 * hardcoded fake reviews). It must only ever surface PUBLISHED, non-deleted
 * reviews — a moderated/hidden review leaking onto the home page is a
 * trust/PDPA problem.
 */
describe('ShopReviewsService.listRecent', () => {
  let service: ShopReviewsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { review: { findMany: jest.fn().mockResolvedValue([]) } };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [ShopReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(ShopReviewsService);
  });

  it('queries PUBLISHED + non-deleted reviews, newest first, with the given limit', async () => {
    await service.listRecent(6);

    expect(prisma.review.findMany).toHaveBeenCalledWith({
      where: { status: 'PUBLISHED', deletedAt: null },
      include: {
        customer: { select: { name: true } },
        product: { select: { brand: true, model: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
  });

  it('defaults to 6 when no limit is given', async () => {
    await service.listRecent();

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }),
    );
  });
});
