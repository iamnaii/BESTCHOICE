import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ProductPhotosService } from './product-photos.service';
import { UploadProductPhotoDto, DeleteProductPhotoDto } from './dto/product-photo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('products/:productId/photos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductPhotosController {
  constructor(private productPhotosService: ProductPhotosService) {}

  @Get()
  getPhotos(@Param('productId') productId: string) {
    return this.productPhotosService.getPhotos(productId);
  }

  @Post('upload')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  uploadPhoto(
    @Param('productId') productId: string,
    @Body() dto: UploadProductPhotoDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.productPhotosService.uploadPhoto(productId, dto.angle, dto.photo, user.id);
  }

  @Delete(':angle')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deletePhoto(
    @Param('productId') productId: string,
    @Param('angle') angle: string,
  ) {
    return this.productPhotosService.deletePhoto(productId, angle);
  }

  @Post('complete')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  completePhotos(
    @Param('productId') productId: string,
  ) {
    return this.productPhotosService.completePhotos(productId);
  }
}
