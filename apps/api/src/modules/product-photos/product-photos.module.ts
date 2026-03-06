import { Module } from '@nestjs/common';
import { ProductPhotosController } from './product-photos.controller';
import { ProductPhotosService } from './product-photos.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProductPhotosController],
  providers: [ProductPhotosService],
  exports: [ProductPhotosService],
})
export class ProductPhotosModule {}
