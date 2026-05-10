import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateExpenseDocumentDto } from './create.dto';

// branchId / documentType immutable
export class UpdateExpenseDocumentDto extends PartialType(
  OmitType(CreateExpenseDocumentDto, ['branchId', 'documentType'] as const),
) {}
