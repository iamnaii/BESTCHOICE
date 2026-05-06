import { PartialType } from '@nestjs/mapped-types';
import { CreateOtherIncomeDto } from './create-other-income.dto';

export class UpdateOtherIncomeDto extends PartialType(CreateOtherIncomeDto) {}
