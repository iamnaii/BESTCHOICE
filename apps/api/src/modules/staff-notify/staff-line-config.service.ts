import { Injectable } from '@nestjs/common';
import { IntegrationConfigService } from '../integrations/integration-config.service';

/**
 * ค่าตั้งของ "ไลน์พนักงาน" (integration key `line-staff`) — อ่านจาก Integration Hub
 * พร้อมใช้ = มี channelToken (กลุ่ม notifyTargets ไม่บังคับ — ส่งตามบทบาทจาก User.lineStaffUserId ได้) · สเปก §13.5
 */
@Injectable()
export class StaffLineConfigService {
  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  async isConfigured(): Promise<boolean> {
    return !!(await this.integrationConfig.getValue('line-staff', 'channelToken'));
  }

  /** "กลุ่ม LINE" — รายชื่อ userId คั่น comma ที่ตั้งไว้ใน Integration Hub (ของเดิมก่อนมีการผูกรายคน) */
  async groupTargets(): Promise<string[]> {
    const raw = (await this.integrationConfig.getValue('line-staff', 'notifyTargets')) || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
}
