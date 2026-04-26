import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShopReservationService } from './shop-reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

@Controller('shop/reservations')
@UseGuards(ShopBotDefenseGuard)
@Throttle({ short: { limit: 30, ttl: 60_000 } })
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
