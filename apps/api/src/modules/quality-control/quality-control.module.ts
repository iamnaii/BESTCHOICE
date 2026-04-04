import { Module } from '@nestjs/common';

import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

import { ProductPhotosController } from './product-photos.controller';
import { ProductPhotosService } from './product-photos.service';

@Module({
  controllers: [InspectionsController, ProductPhotosController],
  providers: [InspectionsService, ProductPhotosService],
  exports: [InspectionsService, ProductPhotosService],
})
export class QualityControlModule {}
