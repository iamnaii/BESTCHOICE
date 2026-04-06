import { IsString } from 'class-validator';

export class AssignCollectorDto {
  @IsString({ message: 'กรุณาระบุผู้รับผิดชอบติดตาม' })
  assignedToId: string;
}
