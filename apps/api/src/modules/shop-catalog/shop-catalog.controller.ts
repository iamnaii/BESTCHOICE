import { Controller, Get, Param, Query, NotFoundException, UseGuards } from '@nestjs/common';
import { ShopCatalogService } from './shop-catalog.service';
import { ListProductsDto } from './dto/list-products.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop')
@UseGuards(ShopBotDefenseGuard)
export class ShopCatalogController {
  constructor(private catalogService: ShopCatalogService) {}

  @Get('products')
  async list(@Query() query: ListProductsDto) {
    const result = await this.catalogService.listGroupedByModel(query);
    return {
      ...result,
      data: result.data.map((g) => ({
        ...g,
        stock: this.catalogService.smartStockCount(g.stockCount),
      })),
    };
  }

  @Get('products/:id')
  async detail(@Param('id') id: string) {
    const product = await this.catalogService.getProductDetail(id);
    if (!product) throw new NotFoundException('สินค้านี้ไม่พบ');
    return product;
  }
}
