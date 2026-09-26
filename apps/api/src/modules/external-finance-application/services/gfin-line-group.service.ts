import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_PRECHECK_TEMPLATE, PRECHECK_TEMPLATE_ERROR_LABEL, validatePrecheckTemplate } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService, LineFinanceNotConfiguredError } from '../../chatbot-finance/services/line-finance-client.service';
import { LineGroupMembershipService } from '../../chatbot-finance/services/line-group-membership.service';
import { FinanceActor, GFIN_COMPANY_NAME, LINE_TEXT_MAX } from '../constants';
import { UpdateGfinPrecheckSettingsDto } from '../dto/gfin-precheck-settings.dto';

export type GfinLineGroupReason = 'NOT_LINKED' | 'BOT_LEFT' | 'NO_TOKEN';
export interface GfinLineGroupStatus {
  groupId: string | null; groupName: string | null; botInGroup: boolean; tokenConfigured: boolean; ready: boolean; reason: GfinLineGroupReason | null;
}
/** ข้อความชี้ทางแก้ — เขียนหลังเปิดหน้าปลายทางแล้ว: ตั้งค่า › การเงิน › GFIN (แท็บ "กลุ่มไลน์ & ข้อความ") และ ตั้งค่า › เชื่อมต่อ › LINE FINANCE */
export const GFIN_LINE_GROUP_REASON_LABEL: Record<GfinLineGroupReason, string> = {
  NOT_LINKED: 'ยังไม่ได้ผูกกลุ่มไลน์ GFIN — ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ',
  BOT_LEFT: 'บอท OA ไฟแนนซ์ไม่อยู่ในกลุ่มแล้ว — เชิญ OA กลับเข้ากลุ่ม แล้วเลือกกลุ่มอีกครั้งในตั้งค่า',
  NO_TOKEN: 'ยังไม่ได้ตั้ง Channel Access Token ของ LINE FINANCE — ตั้งค่า › เชื่อมต่อ',
};
const COPY_HINT = 'ระหว่างนี้ใช้ "คัดลอกข้อความ + ลิงก์" ได้ตามเดิม';

/** กลุ่มไลน์ปลายทางของชุดเช็ค GFIN + แม่แบบข้อความ (spec §6.5, §10) */
@Injectable()
export class GfinLineGroupService {
  constructor(
    private prisma: PrismaService,
    private lineFinance: LineFinanceClientService,
    private memberships: LineGroupMembershipService,
  ) {}

  private company() {
    return this.prisma.externalFinanceCompany.findFirst({
      where: { name: GFIN_COMPANY_NAME, deletedAt: null },
      select: { id: true, name: true, lineGroupId: true, precheckTemplate: true },
    });
  }

  async status(): Promise<GfinLineGroupStatus> {
    const [company, tokenConfigured] = await Promise.all([this.company(), this.lineFinance.isConfigured()]);
    if (!company?.lineGroupId) return { groupId: null, groupName: null, botInGroup: false, tokenConfigured, ready: false, reason: 'NOT_LINKED' };
    const row = await this.memberships.find('FINANCE', company.lineGroupId);
    const botInGroup = !!row && !row.leftAt;
    const reason: GfinLineGroupReason | null = !botInGroup ? 'BOT_LEFT' : !tokenConfigured ? 'NO_TOKEN' : null;
    return { groupId: company.lineGroupId, groupName: row?.groupName ?? null, botInGroup, tokenConfigured, ready: reason === null, reason };
  }

  /** เป้าหมายส่งด้วยบอท — ไม่พร้อม = 400 ชี้ทางแก้ (ปุ่มคัดลอกยังใช้ได้เสมอ) · ตรวจก่อนออกโทเคน/แตะสถานะ */
  async requireSendTarget(): Promise<{ groupId: string; groupName: string | null }> {
    const s = await this.status();
    if (!s.ready || !s.groupId) throw new BadRequestException(`${GFIN_LINE_GROUP_REASON_LABEL[s.reason ?? 'NOT_LINKED']} · ${COPY_HINT}`);
    return { groupId: s.groupId, groupName: s.groupName };
  }

  /** push ข้อความเดียว ≤ 5,000 ตัว (spec §10) — LINE ล้ม = 502 · ไม่มี token = 400 */
  async pushText(groupId: string, text: string): Promise<{ requestId: string | null }> {
    if (text.length > LINE_TEXT_MAX) throw new BadRequestException(`ข้อความยาว ${text.length} ตัวอักษร เกินที่ LINE รับ (${LINE_TEXT_MAX}) — ตัดแม่แบบให้สั้นลง`);
    try {
      return await this.lineFinance.pushMessageStrict(groupId, [{ type: 'text', text }]);
    } catch (err) {
      if (err instanceof LineFinanceNotConfiguredError) throw new BadRequestException(`${GFIN_LINE_GROUP_REASON_LABEL.NO_TOKEN} · ${COPY_HINT}`);
      throw new BadGatewayException(`ส่งเข้ากลุ่มไลน์ไม่สำเร็จ — ลองใหม่อีกครั้ง หรือใช้ "คัดลอกข้อความ + ลิงก์" ไปก่อน`);
    }
  }

  async getSettings() {
    const [company, groups, status] = await Promise.all([this.company(), this.memberships.list('FINANCE'), this.status()]);
    return {
      company: { lineGroupId: company?.lineGroupId ?? null, precheckTemplate: company?.precheckTemplate ?? null },
      groups: groups.map((g) => ({ groupId: g.groupId, groupName: g.groupName, pictureUrl: g.pictureUrl, memberCount: g.memberCount, joinedAt: g.joinedAt, leftAt: g.leftAt })),
      defaultTemplate: DEFAULT_PRECHECK_TEMPLATE,
      status,
    };
  }

  async updateSettings(dto: UpdateGfinPrecheckSettingsDto) {
    const company = await this.company();
    if (!company) throw new NotFoundException('ไม่พบบริษัท GFIN ในระบบ');
    const data: Prisma.ExternalFinanceCompanyUpdateInput = {};
    if (dto.lineGroupId !== undefined) {
      if (dto.lineGroupId === null) data.lineGroupId = null;
      else {
        const row = await this.memberships.find('FINANCE', dto.lineGroupId);
        if (!row) throw new BadRequestException('ไม่พบกลุ่มนี้ในรายการที่บอทเคยเข้า — เชิญ OA ไฟแนนซ์เข้ากลุ่มก่อน แล้วรีเฟรชหน้านี้');
        if (row.leftAt) throw new BadRequestException('บอทออกจากกลุ่มนี้แล้ว — เชิญกลับเข้ากลุ่มก่อนจึงผูกได้');
        data.lineGroupId = dto.lineGroupId;
      }
    }
    if (dto.precheckTemplate !== undefined) {
      const t = dto.precheckTemplate?.trim() ?? '';
      if (!t) data.precheckTemplate = null;
      else {
        const v = validatePrecheckTemplate(t);
        if (v.errors.length) {
          throw new BadRequestException(v.errors.map((e) => (e === 'UNKNOWN_PLACEHOLDER' ? `${PRECHECK_TEMPLATE_ERROR_LABEL[e]}: ${v.unknown.map((u) => `{{${u}}}`).join(', ')}` : PRECHECK_TEMPLATE_ERROR_LABEL[e])).join(' · '));
        }
        data.precheckTemplate = t;
      }
    }
    await this.prisma.externalFinanceCompany.update({ where: { id: company.id }, data });
    return this.getSettings();
  }

  /** ปุ่ม "ส่งข้อความทดสอบ" ในหน้าตั้งค่า (spec §6.5) */
  async sendTestMessage(actor: FinanceActor) {
    const target = await this.requireSendTarget();
    const name = actor.name ?? (await this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? 'พนักงาน';
    const text = `ทดสอบการเชื่อมต่อจาก BESTCHOICE ✅\nระบบพร้อมส่งชุดเช็ค GFIN เข้ากลุ่มนี้แล้ว (ข้อความ 12 ข้อ + ลิงก์เอกสาร)\nส่งโดย ${name} · ข้อความนี้ไม่ต้องตอบ`;
    const r = await this.pushText(target.groupId, text);
    return { ok: true as const, groupName: target.groupName, requestId: r.requestId };
  }
}
