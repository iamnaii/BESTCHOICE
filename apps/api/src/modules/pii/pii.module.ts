import { Global, Module } from '@nestjs/common';
import { PiiAuditService } from './pii-audit.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PiiAuditService],
  exports: [PiiAuditService],
})
export class PiiModule {}
