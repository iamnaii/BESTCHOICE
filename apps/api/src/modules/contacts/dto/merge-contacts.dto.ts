import { IsUUID } from 'class-validator';

export class MergeContactsDto {
  @IsUUID()
  primaryId!: string;

  @IsUUID()
  duplicateId!: string;
}
