import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateAccountingSettingsDto } from './dto/update-accounting-settings.dto';
import { AccountingPermissionsService } from './services/accounting-permissions.service';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('accounting-permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountingPermissionsController {
  constructor(private settings: AccountingPermissionsService) {}

  @Get()
  @Roles('OWNER')
  getSettings(@CurrentUser('id') actorId: string) {
    return this.settings.getSettings(actorId);
  }

  @Put()
  @Roles('OWNER')
  updateSettings(@Body() dto: UpdateAccountingSettingsDto, @CurrentUser('id') actorId: string) {
    return this.settings.updateSettings(dto, actorId);
  }

  @Get('me')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getMyPermissions(@CurrentUser('id') actorId: string) {
    return this.settings.getMyPermissions(actorId);
  }
}
