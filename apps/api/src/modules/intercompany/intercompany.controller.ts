import { Controller, Get, Post, Body, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IntercompanyService } from './intercompany.service';
import { SettleIntercompanyDto } from './dto/settle-intercompany.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Inter-company')
@ApiBearerAuth('JWT')
@Controller('accounting/intercompany')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class IntercompanyController {
  constructor(private intercompany: IntercompanyService) {}

  @Get('balance')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBalance() {
    return this.intercompany.getOutstandingBalance();
  }

  @Post('settle')
  @Roles('OWNER', 'FINANCE_MANAGER')
  settle(@Body() dto: SettleIntercompanyDto, @CurrentUser('id') userId: string) {
    return this.intercompany.settle(dto, userId);
  }
}
