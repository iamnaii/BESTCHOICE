import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentMethodConfigService } from './payment-method-config.service';
import { CreatePaymentMethodConfigDto } from './dto/create-payment-method-config.dto';
import { UpdatePaymentMethodConfigDto } from './dto/update-payment-method-config.dto';

/**
 * /payment-method-configs — bind a PaymentMethod (CASH/TRANSFER/QR) to one or
 * more Chart-of-Accounts codes. Read access available to all cashier-facing
 * roles (the wizard uses this to filter the cash account selector). Write
 * access restricted to OWNER + FINANCE_MANAGER (settings page).
 */
@Controller('payment-method-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentMethodConfigController {
  constructor(private readonly service: PaymentMethodConfigService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  list(@Query('method') method?: string) {
    if (method) return this.service.listByMethod(method);
    return this.service.list();
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER')
  create(@Body() dto: CreatePaymentMethodConfigDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentMethodConfigDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
