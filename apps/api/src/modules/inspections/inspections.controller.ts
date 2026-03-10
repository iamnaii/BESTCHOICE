import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import {
  CreateTemplateDto, UpdateTemplateDto,
  CreateTemplateItemDto, UpdateTemplateItemDto,
  CreateInspectionDto, UpdateInspectionDto, OverrideGradeDto,
} from './dto/inspection.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InspectionsController {
  constructor(private inspectionsService: InspectionsService) {}

  // === Templates ===
  @Get('inspection-templates')
  findAllTemplates() {
    return this.inspectionsService.findAllTemplates();
  }

  @Get('inspection-templates/:id')
  findOneTemplate(@Param('id') id: string) {
    return this.inspectionsService.findOneTemplate(id);
  }

  @Post('inspection-templates')
  @Roles('OWNER')
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.inspectionsService.createTemplate(dto);
  }

  @Patch('inspection-templates/:id')
  @Roles('OWNER')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.inspectionsService.updateTemplate(id, dto);
  }

  @Delete('inspection-templates/:id')
  @Roles('OWNER')
  deleteTemplate(@Param('id') id: string) {
    return this.inspectionsService.deleteTemplate(id);
  }

  // === Template Items ===
  @Post('inspection-templates/:templateId/items')
  @Roles('OWNER')
  addTemplateItem(@Param('templateId') templateId: string, @Body() dto: CreateTemplateItemDto) {
    return this.inspectionsService.addTemplateItem(templateId, dto);
  }

  @Patch('inspection-templates/:templateId/items/:itemId')
  @Roles('OWNER')
  updateTemplateItem(
    @Param('templateId') templateId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTemplateItemDto,
  ) {
    return this.inspectionsService.updateTemplateItem(templateId, itemId, dto);
  }

  @Delete('inspection-templates/:templateId/items/:itemId')
  @Roles('OWNER')
  deleteTemplateItem(@Param('templateId') templateId: string, @Param('itemId') itemId: string) {
    return this.inspectionsService.deleteTemplateItem(templateId, itemId);
  }

  // === Inspections ===
  @Get('inspections')
  findAllInspections(
    @Query('isCompleted') isCompleted?: string,
    @Query('productId') productId?: string,
  ) {
    return this.inspectionsService.findAllInspections({ isCompleted, productId });
  }

  @Get('inspections/:id')
  findOneInspection(@Param('id') id: string) {
    return this.inspectionsService.findOneInspection(id);
  }

  @Post('inspections')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  createInspection(@Body() dto: CreateInspectionDto, @CurrentUser() user: { id: string }) {
    return this.inspectionsService.createInspection(dto, user.id);
  }

  @Patch('inspections/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateInspection(@Param('id') id: string, @Body() dto: UpdateInspectionDto) {
    return this.inspectionsService.updateInspection(id, dto);
  }

  @Post('inspections/:id/complete')
  @Roles('OWNER', 'BRANCH_MANAGER')
  completeInspection(@Param('id') id: string) {
    return this.inspectionsService.completeInspection(id);
  }

  @Patch('inspections/:id/override-grade')
  @Roles('OWNER', 'BRANCH_MANAGER')
  overrideGrade(@Param('id') id: string, @Body() dto: OverrideGradeDto) {
    return this.inspectionsService.overrideGrade(id, dto);
  }
}
