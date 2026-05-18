import { Module } from '@nestjs/common';
import { PDPAController } from './pdpa.controller';
import { PDPAService } from './pdpa.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { PdpaEncryptionService } from './pdpa-encryption.service';
import { PdpaEncryptionController } from './pdpa-encryption.controller';

@Module({
  imports: [PrismaModule, AuthModule, CustomersModule],
  controllers: [PDPAController, PdpaEncryptionController],
  providers: [PDPAService, PdpaEncryptionService],
  exports: [PDPAService, PdpaEncryptionService],
})
export class PDPAModule {}
