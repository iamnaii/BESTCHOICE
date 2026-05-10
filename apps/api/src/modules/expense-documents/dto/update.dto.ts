import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateExpenseDocumentDto } from './create.dto';

// Update allows everything except documentType + branchId (immutable post-create).
export class UpdateExpenseDocumentDto extends PartialType(
  OmitType(CreateExpenseDocumentDto, ['documentType', 'branchId'] as const),
) {}
