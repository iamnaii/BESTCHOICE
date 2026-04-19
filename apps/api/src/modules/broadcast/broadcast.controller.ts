import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
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

  // T4-C6: a SECOND OWNER (not the creator) must approve large-audience or
  // trigger-word-containing broadcasts. Must be a distinct userId from the
  // one who called /send.
  @Post(':id/approve')
  @Roles('OWNER')
  async approve(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.broadcastService.approveBroadcast(id, req.user.id, req.user.role);
  }
}
