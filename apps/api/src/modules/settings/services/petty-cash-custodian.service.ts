import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  PETTY_CASH_CUSTODIAN_ROLES,
  PettyCashCustodianRole,
} from '../settings.constants';

/**
 * D1.1.5.5 — Petty Cash custodian (FK on CompanyInfo). Decomposed out of the
 * monolithic SettingsService (Wave-4). All method bodies are byte-identical
 * to the original; only `this.prisma`/`this.audit` field resolution + import
 * paths changed.
 */
@Injectable()
export class PettyCashCustodianService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Returns the effective custodian role (whitelisted; falls back to default).
   * Used both by the assign endpoint validation and by the UI picker filter.
   */
  async getPettyCashCustodianRole(): Promise<PettyCashCustodianRole> {
    const raw = await this.getKey('petty_cash_custodian_role');
    if (raw && (PETTY_CASH_CUSTODIAN_ROLES as readonly string[]).includes(raw)) {
      return raw as PettyCashCustodianRole;
    }
    return 'ACCOUNTANT';
  }

  /**
   * Local SystemConfig read — mirrors the shared `getKey` accessor so the
   * petty-cash custodian-role lookup stays self-contained within this service
   * (intra-cluster). Behaviour identical to SettingsFlagsService.getKey.
   */
  private async getKey(key: string): Promise<string | null> {
    const row = await this.prisma.systemConfig.findFirst({
      where: { key, deletedAt: null },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  /**
   * Returns the currently-assigned custodian for the given CompanyInfo
   * (or FINANCE by default). Used by both the Settings UI render + future
   * petty-cash voucher footer signing.
   */
  async getPettyCashCustodian(
    companyId?: string,
  ): Promise<{
    companyId: string;
    companyCode: string | null;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  } | null> {
    const company = companyId
      ? await this.prisma.companyInfo.findFirst({
          where: { id: companyId, deletedAt: null },
          include: {
            pettyCashCustodian: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        })
      : await this.prisma.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          include: {
            pettyCashCustodian: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        });
    if (!company) return null;
    const custodianRole = await this.getPettyCashCustodianRole();
    return {
      companyId: company.id,
      companyCode: company.companyCode,
      custodianRole,
      custodian: company.pettyCashCustodian
        ? {
            id: company.pettyCashCustodian.id,
            name: company.pettyCashCustodian.name,
            email: company.pettyCashCustodian.email,
            role: company.pettyCashCustodian.role,
          }
        : null,
    };
  }

  /**
   * Assigns (or clears) the Petty Cash custodian on a CompanyInfo. Validates
   * target user's role against the configured whitelist when assigning;
   * `userId=null` clears the seat (always allowed).
   *
   * Audit `PETTY_CASH_CUSTODIAN_ASSIGNED` action — captures both old + new
   * userIds so reviewers can trace handoffs.
   */
  async assignPettyCashCustodian(
    actorUserId: string,
    opts: { companyId?: string; userId: string | null | undefined },
  ): Promise<{
    companyId: string;
    custodianRole: PettyCashCustodianRole;
    custodian: { id: string; name: string; email: string; role: string } | null;
  }> {
    // Default to FINANCE (single petty-cash drawer for now; SHOP support
    // when SHOP-side accounting lands in Phase A.5).
    const targetCompany = opts.companyId
      ? await this.prisma.companyInfo.findFirst({
          where: { id: opts.companyId, deletedAt: null },
          select: { id: true, companyCode: true, pettyCashCustodianId: true },
        })
      : await this.prisma.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
          select: { id: true, companyCode: true, pettyCashCustodianId: true },
        });
    if (!targetCompany) {
      throw new NotFoundException('ไม่พบข้อมูลบริษัทสำหรับกำหนดผู้ดูแลเงินสดย่อย');
    }

    const newUserId = opts.userId ?? null;
    const role = await this.getPettyCashCustodianRole();

    // Validate the proposed user when assigning (null clears — always OK).
    if (newUserId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: newUserId, isActive: true, deletedAt: null },
        select: { id: true, role: true, name: true, email: true },
      });
      if (!user) {
        throw new NotFoundException('ไม่พบผู้ใช้งานที่จะกำหนดเป็นผู้ดูแลเงินสดย่อย');
      }
      if (user.role !== role) {
        throw new BadRequestException(
          `ผู้ใช้งานต้องมีบทบาท ${role} (พบ ${user.role}) — สามารถเปลี่ยนบทบาทที่อนุญาตได้ที่ SystemConfig.petty_cash_custodian_role`,
        );
      }
    }

    const oldUserId = targetCompany.pettyCashCustodianId;

    await this.prisma.companyInfo.update({
      where: { id: targetCompany.id },
      data: { pettyCashCustodianId: newUserId },
    });

    // Audit log — fire-and-forget per the existing pattern.
    await this.audit.log({
      userId: actorUserId,
      action: 'PETTY_CASH_CUSTODIAN_ASSIGNED',
      entity: 'CompanyInfo',
      entityId: targetCompany.id,
      oldValue: { pettyCashCustodianId: oldUserId },
      newValue: { pettyCashCustodianId: newUserId },
    });

    // Reload the fresh assignment for the response payload.
    const fresh = await this.getPettyCashCustodian(targetCompany.id);
    // getPettyCashCustodian returns null only when the company was deleted
    // mid-transaction (impossible here since we just updated it).
    if (!fresh) {
      throw new NotFoundException('โหลดข้อมูลผู้ดูแลเงินสดย่อยไม่สำเร็จ');
    }
    return {
      companyId: fresh.companyId,
      custodianRole: fresh.custodianRole,
      custodian: fresh.custodian,
    };
  }

  /**
   * Returns the eligible-user pool for the Petty Cash custodian picker.
   * Filtered to active, non-deleted users whose role matches the configured
   * whitelist value. Sorted by name for stable rendering.
   */
  async getEligibleCustodians(): Promise<
    { id: string; name: string; email: string; role: string }[]
  > {
    const role = await this.getPettyCashCustodianRole();
    return this.prisma.user.findMany({
      where: { role, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }
}
