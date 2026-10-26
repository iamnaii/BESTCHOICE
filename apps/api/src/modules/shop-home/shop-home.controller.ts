import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getBranchScope } from '../auth/branch-access.util';
import { canSeeCost, redactShopHome } from '../products/cost-visibility.util';
import { ShopHomeService, type ShopHomeActor } from './shop-home.service';

/**
 * หน้าหลักหน้าร้าน — endpoint เดียวสำหรับหน้า `/` ในโซนหน้าร้าน.
 * อยู่นอก `/dashboard/*` โดยตั้งใจ: controller นั้นปฏิเสธ SALES ทั้งก้อน แต่หน้านี้ SALES ใช้ได้
 * (ตัดต้นทุน/กำไรด้วย redactShopHome และไม่ส่งแถว PO เพราะ /purchase-orders/summary ไม่เปิดให้ SALES).
 */
@ApiTags('Shop Home')
@ApiBearerAuth('JWT')
@Controller('shop-home')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ShopHomeController {
  constructor(private readonly shopHome: ShopHomeService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ข้อมูลหน้าหลักหน้าร้าน: วันนี้ · งานที่ต้องดู · กราฟ 6 เดือน · ขายดี · ค้างสต๊อก' })
  async get(@CurrentUser() user: ShopHomeActor, @Query('branchId') branchId?: string) {
    // บทบาทประจำสาขา (BM, SALES) เห็นเฉพาะสาขาตัวเองเสมอ — BranchGuard แค่ปฏิเสธสาขาคนอื่น ไม่ได้ใส่สาขาให้
    const scope = getBranchScope(user);
    let effectiveBranch: string | undefined;
    if (scope.all) {
      effectiveBranch = branchId || undefined;
    } else if (!scope.branchId) {
      throw new ForbiddenException('บัญชีนี้ยังไม่ผูกสาขา');
    } else {
      effectiveBranch = scope.branchId;
    }

    const full = await this.shopHome.build(user, effectiveBranch);
    const scoped = user.role === 'SALES'
      ? { ...full, watch: full.watch.filter((w) => w.key !== 'PO_APPROVAL') }
      : full;
    return canSeeCost(user.role) ? scoped : redactShopHome(scoped);
  }
}
