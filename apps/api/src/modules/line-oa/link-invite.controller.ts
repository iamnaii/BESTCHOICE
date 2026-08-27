import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IntegrationConfigService } from '../integrations/integration-config.service';

export interface LineLinkInviteResponse {
  /** ตั้งค่า LINE OA ID แล้วหรือยัง — false = หน้าจอบอกให้ไปตั้งค่า ไม่ใช่โชว์ QR เปล่า */
  configured: boolean;
  /** รูปแบบ @xxxx เสมอ (เติม @ ให้ถ้าเจ้าของกรอกมาโดยไม่มี) */
  oaBasicId: string | null;
  /** ลิงก์เพิ่มเพื่อน — เอาไปทำ QR ได้ตรง ๆ */
  addFriendUrl: string | null;
}

/**
 * ข้อมูลสำหรับชวนลูกค้าผูก LINE ร้านที่หน้าร้าน (QR เพิ่มเพื่อน)
 *
 * **แยก endpoint จาก `/integrations/:key/config` โดยตั้งใจ** — เส้นนั้นเป็น
 * `@Roles('OWNER','ACCOUNTANT')` และคืน config ทั้งก้อน (มี token ที่ mask ไว้)
 * ส่วนคนที่ต้องยื่นจอให้ลูกค้าสแกนคือ **พนักงานขายที่เคาน์เตอร์** ⇒ ต้องเปิดกว้างกว่า
 * แต่คืนเฉพาะข้อมูลสาธารณะ (LINE OA ID อยู่บนป้ายหน้าร้านอยู่แล้ว) ไม่มีความลับหลุด
 */
@ApiTags('LINE OA')
@ApiBearerAuth('JWT')
@Controller('line-oa')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LineLinkInviteController {
  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  @Get('link-invite')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  @ApiOperation({ summary: 'ลิงก์/QR เพิ่มเพื่อน LINE ร้าน สำหรับชวนลูกค้าผูกบัญชีที่หน้าร้าน' })
  async getLinkInvite(): Promise<LineLinkInviteResponse> {
    const raw = (await this.integrationConfig.getValue('line-shop', 'oaBasicId'))?.trim();
    if (!raw) return { configured: false, oaBasicId: null, addFriendUrl: null };

    const basicId = raw.startsWith('@') ? raw : `@${raw}`;
    return {
      configured: true,
      oaBasicId: basicId,
      addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`,
    };
  }
}
