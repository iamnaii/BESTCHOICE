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
import { SmsTemplatesService } from './sms-templates.service';
import { CreateSmsTemplateDto } from './dto/create.dto';
import { UpdateSmsTemplateDto } from './dto/update.dto';
import { PreviewSmsTemplateDto } from './dto/preview.dto';
import { CreateVariantDto } from './dto/variant.dto';

@Controller('sms-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmsTemplatesController {
  constructor(private readonly service: SmsTemplatesService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER')
  list(@Query('channel') channel?: string) {
    return this.service.list(channel);
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER')
  create(@Body() dto: CreateSmsTemplateDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSmsTemplateDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/preview')
  @Roles('OWNER', 'FINANCE_MANAGER')
  preview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PreviewSmsTemplateDto,
  ) {
    return this.service.preview(id, dto.sampleData);
  }

  @Post(':id/variant')
  @Roles('OWNER', 'FINANCE_MANAGER')
  createVariant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.service.createVariant(id, dto);
  }
}
