// PR 2a Task 6 (P7) — Permission settings DTO validation.
// Lightweight unit tests on class-validator schema; service-layer persistence is
// covered by existing asset.service.spec.ts smoke paths.

import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreateAssetDto } from '../dto/create-asset.dto';

// Minimal valid payload — only fields used by CreateAssetDto's required validators.
// permissionConfig is exercised independently; other required fields are merely
// kept happy so the test isolates the permissionConfig path.
const baseValidPayload = () => ({
  name: 'Test Asset',
  category: 'EQUIPMENT',
  purchaseDate: '2026-05-15',
  branchId: '00000000-0000-0000-0000-000000000001',
  basePrice: 10000,
  shippingCost: 0,
  installationCost: 0,
  otherCapitalized: 0,
  usefulLifeMonths: 36,
  paymentMethod: 'CASH',
  paymentAccount: '11-1101',
  supplierName: 'Test Vendor',
  hasVat: false,
  hasWht: false,
});

describe('CreateAssetDto — P7 permissionConfig', () => {
  it('accepts valid permissionConfig array', async () => {
    const dto = plainToClass(CreateAssetDto, {
      ...baseValidPayload(),
      permissionConfig: [
        // Real v4 UUIDs — version nibble in 13th hex digit MUST be 4 and
        // variant nibble in 17th MUST be 8/9/a/b. Synthetic all-1s strings
        // pass @IsUUID() (any version) but fail @IsUUID('4').
        { userId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', canView: true, canEdit: true, canPost: true },
        { userId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', canView: true, canEdit: false, canPost: false },
      ],
    });
    const errors = await validate(dto);
    const permissionErrors = errors.filter((e) => e.property === 'permissionConfig');
    expect(permissionErrors).toHaveLength(0);
  });

  it('rejects invalid userId (not UUID)', async () => {
    const dto = plainToClass(CreateAssetDto, {
      ...baseValidPayload(),
      permissionConfig: [
        { userId: 'not-a-uuid', canView: true, canEdit: true, canPost: true },
      ],
    });
    const errors = await validate(dto);
    // class-validator nests array-element errors under the parent property.
    const hasUserIdError = errors.some(
      (e) =>
        e.property === 'permissionConfig' && JSON.stringify(e).includes('userId'),
    );
    expect(hasUserIdError).toBe(true);
  });

  it('treats permissionConfig as optional', async () => {
    const dto = plainToClass(CreateAssetDto, baseValidPayload());
    const errors = await validate(dto);
    const permissionErrors = errors.filter((e) => e.property === 'permissionConfig');
    expect(permissionErrors).toHaveLength(0);
  });
});
