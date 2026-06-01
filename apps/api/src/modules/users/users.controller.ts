import { Controller, Get, Post, Put, Delete, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateExtensionDto } from './dto/update-extension.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SaveSignatureDto } from './dto/save-signature.dto';

@ApiTags('Users')
@ApiBearerAuth('JWT')
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
  saveSignature(@CurrentUser('id') userId: string, @Body() dto: SaveSignatureDto) {
    return this.usersService.saveSignature(userId, dto.signatureImage);
  }

  @Delete('me/signature')
  deleteSavedSignature(@CurrentUser('id') userId: string) {
    return this.usersService.deleteSavedSignature(userId);
  }

  // ─── Admin user management (OWNER only) ────────────
  @Get()
  @Roles('OWNER')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.findAll(
      page ? parseInt(page) : undefined,
      limit ? parseInt(limit) : undefined,
    );
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch('me/extension')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  updateExtension(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateExtensionDto,
  ) {
    return this.usersService.updateExtension(userId, dto.extension);
  }

  @Patch('me/cash-account')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  updateDefaultCashAccount(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateDefaultCashAccount(userId, dto.defaultCashAccountCode ?? null);
  }

  /**
   * InternalControlActionBar — flat list of users + their canReverseOverride
   * flag. Used by ReversePermissionCard. Declared BEFORE `:id` routes so the
   * literal "reverse-overrides" never gets parsed as a UUID.
   */
  @Get('reverse-overrides')
  @Roles('OWNER')
  listReverseOverrides() {
    return this.usersService.listReverseOverrides();
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  /**
   * InternalControlActionBar — per-user override for the CUSTOM reverse
   * permission mode. Toggles `User.canReverseOverride`. OWNER-only because
   * it overrides a SystemConfig policy decision; OWNER is always allowed
   * to reverse regardless of this flag.
   *
   * Setting `value: null` resets to "follow role-based default" — used when
   * switching back from CUSTOM to a role-bundle mode.
   */
  @Put(':id/reverse-override')
  @Roles('OWNER')
  setReverseOverride(
    @Param('id') id: string,
    @Body() body: { canReverseOverride: boolean | null },
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.setReverseOverride(
      id,
      body?.canReverseOverride ?? null,
      actorId,
    );
  }
}
