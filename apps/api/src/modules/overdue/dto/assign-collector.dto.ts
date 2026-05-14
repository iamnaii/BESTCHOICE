import { IsUUID } from 'class-validator';

export class AssignCollectorDto {
  @IsUUID('4', { message: 'assignedToId ต้องเป็น UUID' })
  assignedToId!: string;
}
