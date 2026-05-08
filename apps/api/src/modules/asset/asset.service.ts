import { Injectable } from '@nestjs/common';

@Injectable()
export class AssetService {
  // Phase 1 stub — will be replaced in Tasks 6-8
  findAll(_args: unknown) {
    throw new Error('AssetService.findAll: not implemented (Phase 1 in progress)');
  }
  findOne(_id: string) {
    throw new Error('not implemented');
  }
  create(_dto: unknown, _userId: string) {
    throw new Error('not implemented');
  }
  update(_id: string, _dto: unknown) {
    throw new Error('not implemented');
  }
  dispose(_id: string, _dto: unknown) {
    throw new Error('not implemented');
  }
  runMonthEndDepreciation(_period: string | undefined, _userId: string) {
    throw new Error('not implemented');
  }
  generateAssetCode() {
    throw new Error('not implemented');
  }
  getDepreciationSummary() {
    throw new Error('not implemented');
  }
}
