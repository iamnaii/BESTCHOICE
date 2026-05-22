import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InterestConfigService } from './interest-config.service';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './dto/interest-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Settings')
@ApiBearerAuth('JWT')
@Controller('interest-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InterestConfigController {
  constructor(private service: InterestConfigService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll() {
    return this.service.findAll();
  }

  @Get('by-category/:category')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByCategory(@Param('category') category: string) {
    return this.service.findByCategory(category);
  }

  @Get('resolved')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  resolveConfig(@Query('category') category: string) {
    if (!category) throw new BadRequestException('กรุณาระบุ category');
    return this.service.resolveConfig(category);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateInterestConfigDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateInterestConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
