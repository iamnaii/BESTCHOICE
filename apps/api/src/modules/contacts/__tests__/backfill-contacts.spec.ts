import { resolveBackfillAction } from '../../../../scripts/backfill-contacts';

describe('resolveBackfillAction (safe no-auto-merge dedup)', () => {
  const existing = [
    { id: 'c-tax', taxId: '0105500000001', nationalIdHash: null },
    { id: 'c-nid', taxId: null, nationalIdHash: 'hash-abc' },
  ];

  it('attaches when taxId matches an existing contact', () => {
    const action = resolveBackfillAction(existing, {
      taxId: '0105500000001',
      nationalIdHash: null,
    });
    expect(action).toEqual({ kind: 'attach', contactId: 'c-tax' });
  });

  it('attaches when nationalIdHash matches an existing contact', () => {
    const action = resolveBackfillAction(existing, {
      taxId: null,
      nationalIdHash: 'hash-abc',
    });
    expect(action).toEqual({ kind: 'attach', contactId: 'c-nid' });
  });

  it('creates when the candidate has no identity keys (keyless)', () => {
    const action = resolveBackfillAction(existing, {
      taxId: null,
      nationalIdHash: null,
      phone: '0812345678',
    });
    expect(action).toEqual({ kind: 'create' });
  });

  it('creates when keys are present but match no existing contact', () => {
    const action = resolveBackfillAction(existing, {
      taxId: '9999999999999',
      nationalIdHash: 'hash-unknown',
    });
    expect(action).toEqual({ kind: 'create' });
  });

  it('never auto-merges on phone alone (phone is not an identity key)', () => {
    const withPhone = [{ id: 'c-phone', taxId: null, nationalIdHash: null }];
    const action = resolveBackfillAction(withPhone, {
      taxId: null,
      nationalIdHash: null,
      phone: '0812345678',
    });
    expect(action).toEqual({ kind: 'create' });
  });

  it('prefers taxId match over nationalIdHash when both keys are present', () => {
    const both = [
      { id: 'c-by-tax', taxId: '0105500000001', nationalIdHash: null },
      { id: 'c-by-nid', taxId: null, nationalIdHash: 'hash-abc' },
    ];
    const action = resolveBackfillAction(both, {
      taxId: '0105500000001',
      nationalIdHash: 'hash-abc',
    });
    expect(action).toEqual({ kind: 'attach', contactId: 'c-by-tax' });
  });
});
