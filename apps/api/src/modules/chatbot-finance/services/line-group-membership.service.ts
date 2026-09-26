import { Injectable, Logger } from '@nestjs/common';
import { LineChannelType, LineGroupMembership } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LineFinanceClientService } from './line-finance-client.service';

const TODO_TAG = 'gfin';

/**
 * สมาชิกภาพของบอท OA ไฟแนนซ์ในกลุ่มไลน์ (ยื่น GFIN PR 2, spec §4.1/§10/§13)
 * webhook เรียก onJoin/onLeave · หน้าตั้งค่า GFIN อ่าน list/find · ห้าม throw ออกจาก onJoin/onLeave (LINE ต้องได้ 200)
 */
@Injectable()
export class LineGroupMembershipService {
  private readonly logger = new Logger(LineGroupMembershipService.name);
  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    private notifications: NotificationsService,
  ) {}

  /** บอทถูกเชิญเข้ากลุ่ม (รวมกลับเข้ามาใหม่หลังถูกเตะ) — แถวเดียวต่อ (channel, groupId) · ชื่อ/จำนวนสมาชิกดึงไม่ได้ = คงค่าเดิม */
  async onJoin(channel: LineChannelType, groupId: string): Promise<void> {
    const [summary, memberCount] = await Promise.all([
      this.lineClient.getGroupSummary(groupId),
      this.lineClient.getGroupMemberCount(groupId),
    ]);
    const now = new Date();
    await this.prisma.lineGroupMembership.upsert({
      where: { channel_groupId: { channel, groupId } },
      create: { channel, groupId, groupName: summary?.groupName ?? null, pictureUrl: summary?.pictureUrl ?? null, memberCount, joinedAt: now, leftAt: null },
      update: {
        ...(summary ? { groupName: summary.groupName, pictureUrl: summary.pictureUrl ?? null } : {}),
        ...(memberCount !== null ? { memberCount } : {}),
        joinedAt: now, leftAt: null, deletedAt: null,
      },
    });
    this.logger.log(`[LINE ${channel}] joined group ${groupId.slice(0, 8)}… (${summary?.groupName ?? 'ไม่ทราบชื่อ'})`);
  }

  /** บอทถูกนำออก/กลุ่มถูกยุบ — stamp leftAt · กลุ่มที่ผูกกับบริษัทไฟแนนซ์อยู่ → แจ้ง OWNER/FM (spec §13) */
  async onLeave(channel: LineChannelType, groupId: string): Promise<void> {
    const row = await this.prisma.lineGroupMembership.findFirst({ where: { channel, groupId, deletedAt: null } });
    if (!row) { this.logger.warn(`[LINE ${channel}] leave for unknown group ${groupId.slice(0, 8)}…`); return; }
    await this.prisma.lineGroupMembership.update({ where: { id: row.id }, data: { leftAt: new Date() } });
    const linked = await this.prisma.externalFinanceCompany.findFirst({ where: { lineGroupId: groupId, deletedAt: null }, select: { id: true, name: true } });
    if (linked) await this.notifyBotLeft(linked.name, row.groupName ?? groupId);
  }

  /** กลุ่มที่บอทเคยเข้าใน channel นั้น — ยังอยู่ก่อน แล้วเรียงเข้าล่าสุดก่อน (เรียงใน JS: Prisma nulls-ordering ไม่คุ้มเปิดใช้เพื่อลิสต์สั้น ๆ) */
  async list(channel: LineChannelType): Promise<LineGroupMembership[]> {
    const rows = await this.prisma.lineGroupMembership.findMany({ where: { channel, deletedAt: null } });
    return rows.sort((a, b) => (a.leftAt ? 1 : 0) - (b.leftAt ? 1 : 0) || b.joinedAt.getTime() - a.joinedAt.getTime());
  }

  find(channel: LineChannelType, groupId: string): Promise<LineGroupMembership | null> {
    return this.prisma.lineGroupMembership.findFirst({ where: { channel, groupId, deletedAt: null } });
  }

  private async notifyBotLeft(companyName: string, groupName: string): Promise<void> {
    const title = `บอท OA ไฟแนนซ์ถูกนำออกจากกลุ่มไลน์ "${groupName}" ที่ผูกกับ ${companyName}`;
    const description = [
      'ส่งเช็ค GFIN ด้วยบอทไม่ได้จนกว่าจะเชิญ OA กลับเข้ากลุ่ม — ระหว่างนี้ทีมใช้ปุ่ม "คัดลอกข้อความ + ลิงก์" ได้ตามเดิม',
      'ตรวจ/เปลี่ยนกลุ่มที่ ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ',
    ].join('\n');
    const [admins, system] = await Promise.all([
      this.prisma.user.findMany({ where: { role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null }, select: { id: true } }),
    ]);
    for (const admin of admins) {
      try {
        const open = await this.prisma.todo.findFirst({ where: { assigneeId: admin.id, tags: { has: TODO_TAG }, title, status: { not: 'DONE' }, deletedAt: null }, select: { id: true } });
        if (!open) await this.prisma.todo.create({ data: { title, description, priority: 'HIGH', createdById: system?.id ?? admin.id, assigneeId: admin.id, tags: [TODO_TAG] } });
      } catch (err) {
        this.logger.warn(`todo create failed user=${admin.id}: ${(err as Error).message}`);
      }
      try {
        await this.notifications.send({ channel: 'IN_APP', recipient: admin.id, subject: title, message: description });
      } catch (err) {
        this.logger.warn(`IN_APP notify failed user=${admin.id}: ${(err as Error).message}`);
      }
    }
  }
}
