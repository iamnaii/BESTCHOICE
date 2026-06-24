import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { HASH_TO_CATEGORY, SettingsIndexRedirect } from '../SettingsIndexRedirect';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));

/** Reads the in-memory router location so tests can assert where navigate() landed. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.hash}</div>;
}

function renderRedirect() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsIndexRedirect />
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('HASH_TO_CATEGORY', () => {
  it('map hash tab เก่าครบทุกตัว → หมวดใหม่', () => {
    expect(HASH_TO_CATEGORY).toMatchObject({
      company: 'company',
      vat: 'accounting',
      periods: 'accounting',
      'peak-mapping': 'accounting',
      attachment: 'access',
      'internal-control': 'access',
      users: 'access',
      'offsite-backup': 'system',
      pdpa: 'system',
    });
  });

  it('#contacts is NOT in HASH_TO_CATEGORY (handled by dedicated redirect)', () => {
    expect(HASH_TO_CATEGORY).not.toHaveProperty('contacts');
  });
});

describe('SettingsIndexRedirect — navigation', () => {
  it('#contacts redirects to the standalone /contacts page', () => {
    window.location.hash = '#contacts';
    role = 'OWNER';
    renderRedirect();
    expect(screen.getByTestId('loc').textContent).toBe('/contacts');
  });

  it('mapped hash (#vat) redirects into its category with the anchor preserved', () => {
    window.location.hash = '#vat';
    role = 'OWNER';
    renderRedirect();
    expect(screen.getByTestId('loc').textContent).toBe('/settings/accounting#vat');
  });
});
