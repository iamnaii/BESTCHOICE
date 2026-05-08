import { PartialType } from '@nestjs/swagger';
import { CreateAssetDto } from './create-asset.dto';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {}

// Alias for backward compatibility with existing controller imports
export class UpdateFixedAssetDto extends UpdateAssetDto {}
