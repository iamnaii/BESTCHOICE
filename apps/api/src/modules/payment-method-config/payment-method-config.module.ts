import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentMethodConfigController } from './payment-method-config.controller';
import { PaymentMethodConfigService } from './payment-method-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentMethodConfigController],
  providers: [PaymentMethodConfigService],
  exports: [PaymentMethodConfigService],
})
export class PaymentMethodConfigModule {}
