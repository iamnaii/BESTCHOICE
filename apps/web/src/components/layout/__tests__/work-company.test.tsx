import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { setRequestCompany } from '@/lib/company-scope';
import { LayoutProvider, useLayout } from '../LayoutContext';
import { PillSwitcher } from '../PillSwitcher';
import { getWorkZoneHref, getZoneConfigForRole } from '@/config/menu';

let user: { id: string; role: string; accessibleCompanies: string[] } = { id: 'u1', role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'] };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));
let client: QueryClient;
let requests: string[];
const originalAdapter = api.defaults.adapter;

function Probe() {
  const { currentZone, workZone, enterSettings, exitSettings } = useLayout();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['company-probe'], queryFn: () => api.get('/probe').then(r => r.data) });
  return <>
    {/* แถบสลับบริษัทตัวจริงที่ Sidebar วาด — ต้องอยู่ในต้นไม้นี้ ไม่งั้นเทสต์ "ไม่มี pill" ผ่านฟรี */}
    <PillSwitcher zones={getZoneConfigForRole(user.role, user.accessibleCompanies)?.zones ?? []} current={currentZone} />
    <output data-testid="context">{location.pathname}|{currentZone}|{workZone}</output>
    <output data-testid="data">{query.data ?? 'loading'}</output>
    <button onClick={() => navigate(getWorkZoneHref('/finance-portfolio', 'fin'))}>finance</button>
    <button onClick={() => navigate(getWorkZoneHref('/', 'shop'))}>shop</button>
    <button onClick={() => navigate('/payments')}>shared</button>
    <button onClick={() => navigate(-1)}>back</button>
    <button onClick={() => navigate('/settings/general')}>settings-category</button>
    <button onClick={() => { enterSettings({ zone: workZone, path: location.pathname }); navigate(getWorkZoneHref('/settings', workZone)); }}>settings</button>
    <button onClick={() => { const target = exitSettings({ zone: workZone, path: workZone === 'fin' ? '/finance-portfolio' : '/' }); navigate(target.path); }}>exit</button>
  </>;
}

function App({ entry }: { entry: string }) {
  return <QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>
    <LayoutProvider><Probe /></LayoutProvider>
  </MemoryRouter></QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  setRequestCompany(undefined);
  user = { id: 'u1', role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'] };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  requests = [];
  api.defaults.adapter = async config => {
    requests.push(config.params.company);
    return { data: config.params.company, status: 200, statusText: 'OK', headers: {}, config };
  };
});
afterEach(() => { api.defaults.adapter = originalAdapter; client.clear(); setRequestCompany(undefined); });

describe('one work selection owns the company and its query cache', () => {
  it('a direct FINANCE URL sends FINANCE on its first request despite stale SHOP storage', async () => {
    localStorage.setItem('bc.sidebar.lastZone', 'shop');
    localStorage.setItem('bc-entity-scope', 'SHOP');
    render(<App entry="/finance-portfolio?company=shop" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    expect(requests).toEqual(['finance']);
    expect(localStorage.getItem('bc-entity-scope')).toBe('FINANCE');
  });

  it('changing work company drops the old cache and rejects late SHOP results', async () => {
    let finishShop: (() => void) | undefined;
    api.defaults.adapter = config => {
      requests.push(config.params.company);
      const response = { data: config.params.company, status: 200, statusText: 'OK', headers: {}, config };
      return config.params.company === 'shop'
        ? new Promise(resolve => { finishShop = () => resolve(response); })
        : Promise.resolve(response);
    };
    render(<App entry="/customers" />);
    await waitFor(() => expect(requests).toEqual(['shop']));
    fireEvent.click(screen.getByText('finance', { selector: 'button' }));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    await act(async () => { finishShop?.(); });
    expect(screen.getByTestId('data')).toHaveTextContent('finance');
    expect(client.getQueryData(['company-probe'])).toBe('finance');
    expect(requests).toEqual(['shop', 'finance']);
  });

  it('shared routes preserve FINANCE and back navigation restores the correct company', async () => {
    user.role = 'FINANCE_MANAGER';
    render(<App entry="/payments?zone=fin" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    fireEvent.click(screen.getByText('shop', { selector: 'button' }));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    fireEvent.click(screen.getByText('back'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    expect(screen.getByTestId('context')).toHaveTextContent('/payments|fin|fin');
  });

  it('settings and a reload keep the last work company without preserving stale return paths', async () => {
    const view = render(<App entry="/finance-portfolio" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    fireEvent.click(screen.getByText('settings', { selector: 'button' }));
    expect(screen.getByTestId('context')).toHaveTextContent('/settings|settings|fin');
    fireEvent.click(screen.getByText('settings-category'));
    expect(screen.getByTestId('context')).toHaveTextContent('/settings/general|settings|fin');
    expect(screen.getByTestId('data')).toHaveTextContent('finance');
    view.unmount();
    render(<App entry="/settings" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    fireEvent.click(screen.getByText('exit'));
    expect(screen.getByTestId('context')).toHaveTextContent('/finance-portfolio|fin|fin');
  });

  it('returning to a FINANCE settings history entry restores FINANCE after visiting SHOP', async () => {
    render(<App entry="/finance-portfolio" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    fireEvent.click(screen.getByText('settings', { selector: 'button' }));
    fireEvent.click(screen.getByText('shop', { selector: 'button' }));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    fireEvent.click(screen.getByText('back'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    expect(screen.getByTestId('context')).toHaveTextContent('/settings|settings|fin');
    fireEvent.click(screen.getByText('settings-category'));
    expect(screen.getByTestId('context')).toHaveTextContent('/settings/general|settings|fin');
    expect(screen.getByTestId('data')).toHaveTextContent('finance');
  });

  it('same-user permission changes remove the unavailable company before any new page request', async () => {
    const view = render(<App entry="/finance-portfolio" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('finance'));
    user = { ...user, accessibleCompanies: ['SHOP'] };
    view.rerender(<App entry="/finance-portfolio" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    expect(screen.getByTestId('context')).toHaveTextContent('/|shop|shop');
    expect(requests).toEqual(['finance', 'shop']);
  });

  it('a SHOP-only user cannot open FINANCE through a direct link or the old company parameter', async () => {
    user.accessibleCompanies = ['SHOP'];
    render(<App entry="/finance-portfolio?company=finance&zone=fin" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    expect(requests).toEqual(['shop']);
  });

  // 2026-09-08: accessible_companies ไม่เคยถูกเขียนเลยตั้งแต่ migration ทุกคนจึงมี [] และ
  // เงื่อนไข `!companies` ที่เดิมอยู่ใน getZoneConfigForRole ทำให้โซนถูกกรองทิ้งหมด =
  // ทั้งบริษัทเห็นแต่ป้าย alert แทนแอป สองเทสต์นี้กันไม่ให้กลับมาอีก
  it('an account that has never been backfilled ([]) still gets its role default, not the lockout alert', async () => {
    user = { id: 'u1', role: 'OWNER', accessibleCompanies: [] };
    render(<App entry="/" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(requests[0]).toBe('shop');
    expect(screen.getAllByRole('tablist', { name: 'หมวดงาน' })).toHaveLength(1);
  });

  it('SALES with [] sees the app in SHOP only — the fallback grants a role default, not everything', async () => {
    user = { id: 'u2', role: 'SALES', accessibleCompanies: [] };
    render(<App entry="/" />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('shop'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryAllByRole('tablist', { name: 'หมวดงาน' })).toHaveLength(0);
    expect(requests).toEqual(['shop']);
  });
});
