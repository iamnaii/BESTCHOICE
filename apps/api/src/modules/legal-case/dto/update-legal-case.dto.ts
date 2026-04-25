import { PartialType } from '@nestjs/swagger';
import { CreateLegalCaseDto } from './create-legal-case.dto';

/**
 * Update LegalCase DTO — every field optional, same validation rules.
 */
export class UpdateLegalCaseDto extends PartialType(CreateLegalCaseDto) {}
