import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerPiiService } from './customer-pii.service';

/**
 * Hotfix 2026-05-18 — CustomerPiiService extracted into its own minimal module
 * so PDPAModule can consume it without pulling in the full CustomersModule
 * (which transitively reaches the ChatEngineModule ↔ StaffChatModule cycle
 * via OverdueModule → ChatEngineModule → StaffChatModule).
 *
 * CustomerPiiService depends only on PrismaService — no chat/customer/overdue
 * deps — so this module is leaf and safe to import from anywhere.
 *
 * CustomersModule continues to re-export CustomerPiiService for its own use;
 * PDPAModule imports THIS module instead.
 */
@Module({
  imports: [PrismaModule],
  providers: [CustomerPiiService],
  exports: [CustomerPiiService],
})
export class CustomerPiiModule {}
// hotfix 2026-05-18
// hotfix trigger 2
