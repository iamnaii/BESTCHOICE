import { AccessTradeInBoundaries } from './access-trade-in-boundaries';
import { AccessTradeInProjectionService } from './access-trade-in-projection.service';
import { AccessAdjustmentsBoundaries } from './access-adjustments-boundaries';
import { AccessInventoryBoundaries } from './access-inventory-boundaries';
import { AccessProcurementBoundaries } from './access-procurement-boundaries';
import { AccessProcurementSourceService } from './access-procurement-source.service';
import { AccessProcurementProjectionService } from './access-procurement-projection.service';
import { AccessResourceService } from './access-resource.service';
import { AccessSensitiveService } from './access-sensitive.service';
import { AccessShopBoundaries } from './access-shop-boundaries';
import { AccessSocketBoundary } from './access-socket-boundary';
import { AccessPolicyService } from './access-policy';
import { Global, Module } from '@nestjs/common';
import { EmployeeAccessController } from './employee-access.controller';
import { EmployeeAccessService } from './employee-access.service';
import { AccessSnapshotService } from './access-snapshot.service';

// No AuthModule import: JWT strategy can consume snapshots without a module cycle.
@Global()
@Module({
  controllers: [EmployeeAccessController],
  providers: [AccessTradeInBoundaries, AccessTradeInProjectionService, AccessAdjustmentsBoundaries, AccessInventoryBoundaries, AccessProcurementBoundaries, AccessProcurementSourceService, AccessProcurementProjectionService, AccessResourceService, AccessSensitiveService, AccessShopBoundaries, EmployeeAccessService, AccessSnapshotService, AccessPolicyService, AccessSocketBoundary],
  exports: [AccessProcurementSourceService, AccessProcurementProjectionService, AccessResourceService, AccessSensitiveService, EmployeeAccessService, AccessSnapshotService, AccessPolicyService, AccessSocketBoundary],
})
export class EmployeeAccessModule {}
