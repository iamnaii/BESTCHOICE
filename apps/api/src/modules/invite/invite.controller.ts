import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InviteService } from './invite.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RegisterInviteDto } from './dto/register-invite.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('invite')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InviteController {
  constructor(private inviteService: InviteService) {}

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateInviteDto, @Request() req: { user: { id: string } }) {
    return this.inviteService.create(dto, req.user.id);
  }

  @Get()
  @Roles('OWNER')
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.inviteService.findAll(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Post(':id/resend')
  @Roles('OWNER')
  resend(@Param('id') id: string, @Request() req: { user: { id: string } }) {
    return this.inviteService.resend(id, req.user.id);
  }

  @Delete(':id')
  @Roles('OWNER')
  revoke(@Param('id') id: string) {
    return this.inviteService.revoke(id);
  }

  @Get('verify')
  @Public()
  verify(@Query('token') token: string) {
    if (!token) {
      return { valid: false };
    }
    return this.inviteService.verify(token);
  }

  @Post('register')
  @Public()
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  register(@Body() dto: RegisterInviteDto) {
    return this.inviteService.register(dto);
  }
}
