import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';

import { StockAdjustmentsController } from './stock-adjustments.controller';
import { StockAdjustmentsService } from './stock-adjustments.service';

import { StockCountController } from './stock-count.controller';
import { StockCountService } from './stock-count.service';

import { ReorderPointsController } from './reorder-points.controller';
import { ReorderPointsService } from './reorder-points.service';

import { BranchReceivingController } from './branch-receiving.controller';
import { BranchReceivingService } from './branch-receiving.service';

import { InventoryForecastController } from './inventory-forecast.controller';
import { InventoryForecastService } from './inventory-forecast.service';

@Module({
  imports: [NotificationsModule],
  controllers: [
    StockAdjustmentsController,
    StockCountController,
    ReorderPointsController,
    BranchReceivingController,
    InventoryForecastController,
  ],
  providers: [
    StockAdjustmentsService,
    StockCountService,
    ReorderPointsService,
    BranchReceivingService,
    InventoryForecastService,
  ],
  exports: [
    StockAdjustmentsService,
    StockCountService,
    ReorderPointsService,
    BranchReceivingService,
    InventoryForecastService,
  ],
})
export class InventoryModule {}
