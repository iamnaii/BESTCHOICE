import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ShopReservationService } from './shop-reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

@Controller('shop/reservations')
export class ShopReservationController {
  constructor(private reservationService: ShopReservationService) {}

  @Post()
  async create(@Body() dto: CreateReservationDto) {
    return this.reservationService.reserve(dto);
  }

  @Delete(':id')
  async cancel(@Param('id') id: string, @Body('sessionId') sessionId: string) {
    return this.reservationService.cancel(id, sessionId);
  }
}
