import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrepareOfferDto } from './dto/prepare-offer.dto';
import { PrepareOfferService } from './services/prepare-offer.service';
import { StaffAiActor } from './services/room-ai-access.service';

@Controller('staff-chat/rooms/:roomId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RoomAssistanceController {
  constructor(private readonly offers: PrepareOfferService) {}

  @Post('prepare-offer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  prepare(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() input: PrepareOfferDto,
    @Req() request: { user: StaffAiActor },
  ) {
    return this.offers.prepare(roomId, input, request.user);
  }
}
