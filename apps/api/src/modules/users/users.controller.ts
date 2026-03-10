import { Controller, Get, Post, Put, Delete, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ─── Saved Signature (any authenticated user) ──────
  @Get('me/signature')
  getSavedSignature(@CurrentUser('id') userId: string) {
    return this.usersService.getSavedSignature(userId).then((sig) => ({ signatureImage: sig }));
  }

  @Put('me/signature')
  saveSignature(@CurrentUser('id') userId: string, @Body('signatureImage') signatureImage: string) {
    return this.usersService.saveSignature(userId, signatureImage);
  }

  @Delete('me/signature')
  deleteSavedSignature(@CurrentUser('id') userId: string) {
    return this.usersService.deleteSavedSignature(userId);
  }

  // ─── Admin user management (OWNER only) ────────────
  @Get()
  @Roles('OWNER')
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }
}
