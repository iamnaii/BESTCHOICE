import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Broadcast')
@ApiBearerAuth('JWT')
@Controller('broadcast')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BroadcastController {
  constructor(private broadcastService: BroadcastService) {}

  @Post('send')
  @Roles('OWNER')
  async send(@Body() dto: CreateBroadcastDto, @Req() req: any) {
    return this.broadcastService.sendBroadcast(dto, req.user.id);
  }
}
