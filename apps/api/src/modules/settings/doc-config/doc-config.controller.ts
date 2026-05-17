import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DocConfigService } from './doc-config.service';
import { PreviewDocConfigDto, UpdateDocConfigDto } from './dto/update-doc-config.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * SP4 — Document Number Config endpoints.
 *
 * GET / + GET /:docType + POST /:docType/preview are open to roles that need
 * to see the format (OWNER + FINANCE_MANAGER + ACCOUNTANT). Edits are
 * OWNER-only per the Settings convention in accounting.md.
 */
@ApiTags('Settings — Doc Number Config')
@ApiBearerAuth('JWT')
@Controller('settings/doc-config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocConfigController {
  constructor(private readonly service: DocConfigService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list() {
    return this.service.findAll();
  }

  @Get(':docType')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getOne(@Param('docType') docType: string) {
    return this.service.findByType(docType);
  }

  @Patch(':docType')
  @Roles('OWNER')
  update(
    @Param('docType') docType: string,
    @Body() dto: UpdateDocConfigDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.update(docType, dto, user.id);
  }

  @Post(':docType/preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  preview(@Param('docType') docType: string, @Body() dto: PreviewDocConfigDto) {
    return this.service.preview(docType, dto);
  }
}
