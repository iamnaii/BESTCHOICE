import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IntegrationsService } from './integrations.service';
import { IntegrationConfigService } from './integration-config.service';
import { getIntegrationDef, INTEGRATIONS } from './integration-registry';

@ApiTags('Integrations')
@ApiBearerAuth('JWT')
@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: IntegrationConfigService,
  ) {}

  @Get()
  @Roles('OWNER')
  @ApiOperation({ summary: 'รายการ integration ทั้งหมดพร้อมสถานะ' })
  listAll() {
    return this.integrationsService.listAll();
  }

  @Get('registry')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Integration definitions สำหรับสร้าง form ฝั่ง frontend' })
  getRegistry() {
    return INTEGRATIONS;
  }

  @Get(':key/config')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ดู config ที่ masked สำหรับ integration' })
  async getConfig(@Param('key') key: string) {
    const def = getIntegrationDef(key);
    const masked = await this.configService.getMaskedConfig(key);
    return { integration: def, config: masked };
  }

  @Put(':key/config')
  @Roles('OWNER')
  @ApiOperation({ summary: 'บันทึก config สำหรับ integration' })
  saveConfig(@Param('key') key: string, @Body() body: Record<string, string>) {
    return this.configService.saveConfig(key, body);
  }

  @Post(':key/test')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ทดสอบการเชื่อมต่อ integration' })
  testConnection(@Param('key') key: string) {
    return this.integrationsService.testConnection(key);
  }

  @Delete(':key/config')
  @Roles('OWNER')
  @ApiOperation({ summary: 'ลบ config (revert ไปใช้ env)' })
  deleteConfig(@Param('key') key: string) {
    return this.configService.deleteConfig(key);
  }
}
