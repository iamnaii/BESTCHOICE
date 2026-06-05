import { selectProfileCandidates } from './backfill-employee-profiles.cli';

describe('selectProfileCandidates', () => {
  const users = [
    { id: 'u1', isSystemUser: false, deletedAt: null },
    { id: 'u2', isSystemUser: false, deletedAt: null },
    { id: 'sys', isSystemUser: true, deletedAt: null },
    { id: 'gone', isSystemUser: false, deletedAt: new Date() },
  ];

  it('returns active non-system users that have no profile yet', () => {
    const out = selectProfileCandidates(users, new Set(['u2'])); // u2 already has a profile
    expect(out.map((u) => u.id)).toEqual(['u1']);
  });

  it('excludes system users and soft-deleted users', () => {
    const out = selectProfileCandidates(users, new Set());
    expect(out.map((u) => u.id).sort()).toEqual(['u1', 'u2']); // not sys, not gone
  });

  it('is empty when every eligible user already has a profile (idempotent re-run)', () => {
    const out = selectProfileCandidates(users, new Set(['u1', 'u2']));
    expect(out).toEqual([]);
  });
});
