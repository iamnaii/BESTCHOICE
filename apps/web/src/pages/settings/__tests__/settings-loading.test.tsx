import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { searchSettings, settingsNavGroups } from '@/config/settings-access';
import { CategoryPage } from '../CategoryPage';
import { SettingsItemRoute } from '../SettingsItemRoute';

const loaded = vi.hoisted(() => ({
  company: vi.fn(),
  entities: vi.fn(),
  ai: vi.fn(),
}));
let role = 'OWNER';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/pages/SettingsPage/tabs/CompanyTab', () => {
  loaded.company();
  return { CompanyTab: () => <div>company-form</div> };
});
vi.mock('@/pages/CompanySettingsPage', () => {
  loaded.entities();
  return { default: () => <div>entities-page</div> };
});
vi.mock('@/pages/AiSettingsPage', () => {
  loaded.ai();
  return { default: () => <div>ai-page</div> };
});

function renderEntities() {
  return render(
    <MemoryRouter initialEntries={['/settings/company/entities']}>
      <Routes>
        <Route path="/settings/:categoryId/:itemId" element={<SettingsItemRoute />} />
        <Route path="/settings/:categoryId" element={<div>category-fallback</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('settings code loading', () => {
  it('loads only permitted content when opened, while navigation, search and anchors stay available', async () => {
    expect(settingsNavGroups('OWNER')).toHaveLength(4);
    expect(searchSettings('AI Assistant', 'OWNER')).toHaveLength(1);
    expect(searchSettings('tax id', 'OWNER')[0].item.id).toBe('company-info');
    expect(loaded.company).not.toHaveBeenCalled();
    expect(loaded.entities).not.toHaveBeenCalled();
    expect(loaded.ai).not.toHaveBeenCalled();

    role = 'ACCOUNTANT';
    const denied = renderEntities();
    expect(screen.getByText('category-fallback')).toBeInTheDocument();
    expect(loaded.entities).not.toHaveBeenCalled();
    denied.unmount();

    role = 'OWNER';
    const category = render(<MemoryRouter><CategoryPage categoryId="company" /></MemoryRouter>);
    expect(document.getElementById('company-info')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดข้อมูลบริษัท');
    expect(screen.getByRole('link', { name: 'บริษัทในเครือ' })).toHaveAttribute(
      'href', '/settings/company/entities',
    );
    expect(await screen.findByText('company-form')).toBeInTheDocument();
    expect(loaded.company).toHaveBeenCalledTimes(1);
    expect(loaded.entities).not.toHaveBeenCalled();
    expect(loaded.ai).not.toHaveBeenCalled();
    category.unmount();

    renderEntities();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังโหลดบริษัทในเครือ');
    expect(await screen.findByText('entities-page')).toBeInTheDocument();
    expect(loaded.entities).toHaveBeenCalledTimes(1);
    expect(loaded.ai).not.toHaveBeenCalled();
  });
});
