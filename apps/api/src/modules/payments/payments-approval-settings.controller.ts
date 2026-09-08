import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdatePaymentApprovalSettingsDto } from './dto/update-payment-approval-settings.dto';
import { PaymentApprovalSettingsService } from './services/payment-approval-settings.service';

@ApiTags('Payments')
@ApiBearerAuth('JWT')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsApprovalSettingsController {
  constructor(private settings: PaymentApprovalSettingsService) {}

  @Get('approval-settings')
  @Roles('OWNER')
  getSettings(@CurrentUser('id') actorId: string) {
    return this.settings.getSettings(actorId);
  }

  @Put('approval-settings')
  @Roles('OWNER')
  updateSettings(@Body() dto: UpdatePaymentApprovalSettingsDto, @CurrentUser('id') actorId: string) {
    return this.settings.updateSettings(dto, actorId);
  }

  @Get('approval-permissions/me')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getMyPermissions(@CurrentUser('id') actorId: string) {
    return this.settings.getMyPermissions(actorId);
  }
}
