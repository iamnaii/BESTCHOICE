import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InspectionsService } from './inspections.service';
import { OverrideGradeDto } from './dto/inspection.dto';

/**
 * Characterization tests for InspectionsService.overrideGrade (Wave 3 LOW gap-fill).
 *
 * overrideGrade is the manual-override escape hatch for the auto-grading engine:
 * after an inspection is COMPLETED, an operator can pin a different resale grade
 * (gradeOverride) with a verbatim reason. The three sibling specs cover the
 * auto-grading math (inspections.service.spec.ts +
 * inspections.calculate-grade.spec.ts), the per-scoreType lookup +
 * completeInspection orchestration (inspections.grade-mapping.spec.ts) — none of
 * them touch overrideGrade. This file pins:
 *
 *  - the completion guard (195-197): overriding a NOT-yet-completed inspection
 *    throws BadRequestException('กรุณาตรวจให้เสร็จก่อน') BEFORE any write;
 *  - the persistence (199-202): on a COMPLETED inspection it writes
 *    `gradeOverride` + `overrideReason` verbatim from the DTO (the auto-computed
 *    `overallGrade` is left untouched — override is a separate column), then
 *    re-fetches the record.
 *
 * overrideGrade walks findOneInspection → update → findOneInspection, so
 * `inspection.findUnique` is mocked to answer the two reads in order (before /
 * after), mirroring the completeInspection mock shape in
 * inspections.grade-mapping.spec.ts.
 */

const makePrisma = (
  before: { isCompleted: boolean; products?: { id: string }[] },
  after: Record<string, unknown> = {},
) => {
  const findUnique = jest
    .fn()
    .mockResolvedValueOnce({ products: [], ...before })
    .mockResolvedValueOnce(after);
  const update = jest.fn().mockResolvedValue({});
  const productUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    inspection: { findUnique, update },
    product: { update: productUpdate },
  } as unknown as PrismaService;
  return { prisma, findUnique, update, productUpdate };
};

const dto = (grade: string, reason: string): OverrideGradeDto =>
  ({ grade, reason }) as OverrideGradeDto;

describe('InspectionsService.overrideGrade (195-206)', () => {
  it('throws BadRequestException on a NOT-yet-completed inspection, before any write', async () => {
    const { prisma, update } = makePrisma({ isCompleted: false });
    const svc = new InspectionsService(prisma);

    await expect(svc.overrideGrade('insp-1', dto('B', 'cosmetic scratches'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // the guard fires before persistence — no update is attempted
    expect(update).not.toHaveBeenCalled();
  });

  it('throws with the exact Thai guard message กรุณาตรวจให้เสร็จก่อน', async () => {
    const { prisma } = makePrisma({ isCompleted: false });
    const svc = new InspectionsService(prisma);

    await expect(svc.overrideGrade('insp-1', dto('B', 'r'))).rejects.toThrow('กรุณาตรวจให้เสร็จก่อน');
  });

  it('writes gradeOverride + overrideReason verbatim on a COMPLETED inspection', async () => {
    const { prisma, update } = makePrisma(
      { isCompleted: true },
      { id: 'insp-1', gradeOverride: 'C', overrideReason: 'ตำหนิที่หน้าจอ' },
    );
    const svc = new InspectionsService(prisma);

    await svc.overrideGrade('insp-1', dto('C', 'ตำหนิที่หน้าจอ'));

    // exactly gradeOverride + overrideReason are persisted — overallGrade
    // (the auto-computed column) is intentionally NOT written here
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'insp-1' },
      data: { gradeOverride: 'C', overrideReason: 'ตำหนิที่หน้าจอ' },
    });
  });

  it('persists the reason string verbatim (no trim / normalisation)', async () => {
    const reason = '  มีรอยขีดข่วน + แบตเสื่อม  ';
    const { prisma, update } = makePrisma({ isCompleted: true });
    const svc = new InspectionsService(prisma);

    await svc.overrideGrade('insp-1', dto('D', reason));

    expect(update.mock.calls[0][0].data.overrideReason).toBe(reason);
    expect(update.mock.calls[0][0].data.gradeOverride).toBe('D');
  });

  it('returns the re-fetched inspection (findOneInspection runs twice: guard + reload)', async () => {
    const after = { id: 'insp-1', gradeOverride: 'A', overrideReason: 'mint condition' };
    const { prisma, findUnique, update } = makePrisma({ isCompleted: true }, after);
    const svc = new InspectionsService(prisma);

    const out = (await svc.overrideGrade('insp-1', dto('A', 'mint condition'))) as {
      gradeOverride: string;
    };

    // findUnique is called twice (before-guard read + post-update reload)
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
    // the value returned is the reloaded record, not the update() result
    expect(out.gradeOverride).toBe('A');
  });

  it('B0: เขียน conditionGrade ลงทุกเครื่องที่ผูกกับใบตรวจ', async () => {
    const { prisma, productUpdate } = makePrisma({
      isCompleted: true,
      products: [{ id: 'prod-1' }, { id: 'prod-2' }],
    });
    const svc = new InspectionsService(prisma);
    await svc.overrideGrade('insp-1', dto('C', 'จอมีรอย'));
    expect(productUpdate).toHaveBeenCalledTimes(2);
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-2' },
      data: { conditionGrade: 'C' },
    });
  });
});
