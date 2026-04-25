import { IsObject, IsOptional } from 'class-validator';

export class PreviewSmsTemplateDto {
  /**
   * Optional sample variable map. When omitted, the service synthesises a
   * canonical sample (customerName / contractNumber / amount / etc.) so
   * the editor can preview a freshly-created template without typing data.
   */
  @IsOptional()
  @IsObject({ message: 'sampleData ต้องเป็น object' })
  sampleData?: Record<string, string | number>;
}
