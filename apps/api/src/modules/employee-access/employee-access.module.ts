import { Global, Module } from '@nestjs/common';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessService } from './employee-access.service';
import { AccessSnapshotService } from './access-snapshot.service';

// No AuthModule import: JWT strategy can consume snapshots without a module cycle.
@Global()
@Module({
  controllers: [EmployeeAccessController],
  providers: [EmployeeAccessService, AccessSnapshotService],
  exports: [EmployeeAccessService, AccessSnapshotService],
})
export class EmployeeAccessModule {}
