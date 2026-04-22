import { Module } from '@nestjs/common';
import { ShopInstallmentApplyController } from './shop-installment-apply.controller';
import { ShopInstallmentApplyAdminController } from './shop-installment-apply.admin.controller';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, LineOaModule, AuthModule],
  controllers: [ShopInstallmentApplyController, ShopInstallmentApplyAdminController],
  providers: [ShopInstallmentApplyService],
  exports: [ShopInstallmentApplyService],
})
export class ShopInstallmentApplyModule {}
