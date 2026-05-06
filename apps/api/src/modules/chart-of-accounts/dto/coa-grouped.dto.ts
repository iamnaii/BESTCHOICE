import { IsOptional, IsString, Matches } from 'class-validator';

export class CoaGroupedQueryDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}(-\d{0,4})?$/, { message: 'codePrefix must match XX or XX-XXXX' })
  codePrefix?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export interface CoaAccountRow {
  code: string;
  name: string;
  normalBalance: string;
  vatApplicable: boolean;
  notes: string | null;
}

export interface CoaGroup {
  category: string;
  accounts: CoaAccountRow[];
}

export interface CoaGroupedResponse {
  groups: CoaGroup[];
}
