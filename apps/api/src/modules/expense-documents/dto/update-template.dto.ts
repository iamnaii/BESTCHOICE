import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTemplateDto } from './create-template.dto';

// Cannot change documentType or branchId once created
export class UpdateTemplateDto extends PartialType(
  OmitType(CreateTemplateDto, ['documentType', 'branchId'] as const),
) {}
