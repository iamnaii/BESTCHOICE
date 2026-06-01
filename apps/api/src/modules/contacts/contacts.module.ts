import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactResolverService } from './contact-resolver.service';

// PrismaModule is @Global() (see prisma/prisma.module.ts) — PrismaService is
// injectable everywhere without an explicit import here, mirroring how
// customers.module.ts relies on the global provider.
@Module({
  controllers: [ContactsController],
  providers: [ContactsService, ContactResolverService],
  exports: [ContactResolverService],
})
export class ContactsModule {}
