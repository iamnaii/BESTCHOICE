import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountingPermissions } from '@/hooks/useAccountingPermissions';
import type { AccountingPermissionsMe } from '@/lib/accounting-permissions';

let currentUser: { id: string; name: string; role: string } | null;
const apiGet = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }));
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => apiGet(...args) } }));

const clients: QueryClient[] = [];
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 180000 } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
function response(id = 'accountant', permissions: AccountingPermissionsMe['permissions'] = ['EXPENSE_POST']): AccountingPermissionsMe {
  return { user: { id, name: id, role: 'ACCOUNTANT', branchId: null }, permissions };
}
function deferred() {
  let resolve!: (value: { data: AccountingPermissionsMe }) => void;
  const promise = new Promise<{ data: AccountingPermissionsMe }>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  currentUser = { id: 'accountant', name: 'Accountant', role: 'ACCOUNTANT' };
  apiGet.mockReset();
});
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); });

describe('useAccountingPermissions', () => {
  it('uses only server grants, without a manager or OWNER role fallback', async () => {
    currentUser = { id: 'owner', name: 'Owner', role: 'OWNER' };
    apiGet.mockResolvedValue({ data: response('owner', []) });
    const { result } = renderHook(() => useAccountingPermissions(), harness());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.can('EXPENSE_POST')).toBe(false);
    expect(result.current.can('INCOME_APPROVE')).toBe(false);
    expect(apiGet).toHaveBeenCalledWith('/accounting-permissions/me');
  });

  it('grants each capability independently after the authenticated response arrives', async () => {
    apiGet.mockResolvedValue({ data: response('accountant', ['INCOME_APPROVE']) });
    const { result } = renderHook(() => useAccountingPermissions(), harness());
    await waitFor(() => expect(result.current.can('INCOME_APPROVE')).toBe(true));
    expect(result.current.can('INCOME_POST')).toBe(false);
    expect(result.current.can('EXPENSE_APPROVE')).toBe(false);
  });

  it('does not reuse cached rights while a fresh permission request is pending', async () => {
    const { client, wrapper } = harness();
    client.setQueryData(['accounting-permissions', 'me', 'accountant'], response());
    const next = deferred(); apiGet.mockReturnValue(next.promise);
    const { result } = renderHook(() => useAccountingPermissions(), { wrapper });
    await waitFor(() => expect(apiGet).toHaveBeenCalledOnce());
    expect(result.current.can('EXPENSE_POST')).toBe(false);
    await act(async () => { next.resolve({ data: response('accountant', []) }); });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.can('EXPENSE_POST')).toBe(false);
  });

  it('fails closed after a refresh error even with old grants in cache', async () => {
    const { client, wrapper } = harness();
    client.setQueryData(['accounting-permissions', 'me', 'accountant'], response());
    apiGet.mockRejectedValue(new Error('unavailable'));
    const { result } = renderHook(() => useAccountingPermissions(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.can('EXPENSE_POST')).toBe(false);
  });

  it('does not carry grants into another signed-in account or accept a mismatched response', async () => {
    apiGet.mockResolvedValueOnce({ data: response() });
    const { result, rerender } = renderHook(() => useAccountingPermissions(), harness());
    await waitFor(() => expect(result.current.can('EXPENSE_POST')).toBe(true));
    const next = deferred(); apiGet.mockReturnValue(next.promise);
    currentUser = { id: 'different', name: 'Different', role: 'ACCOUNTANT' }; rerender();
    expect(result.current.can('EXPENSE_POST')).toBe(false);
    await act(async () => { next.resolve({ data: response('accountant') }); });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.can('EXPENSE_POST')).toBe(false);
  });

  it.each([null, { id: '', name: 'No identity', role: 'OWNER' }])('requires a nonempty authenticated id before requesting permissions: %j', (user) => {
    currentUser = user;
    const { result } = renderHook(() => useAccountingPermissions(), harness());
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.can('EXPENSE_POST')).toBe(false);
  });

  it('does not expose cached grants after the same user loses access to accounting roles', () => {
    currentUser = { id: 'accountant', name: 'Accountant', role: 'SALES' };
    const { client, wrapper } = harness();
    client.setQueryData(['accounting-permissions', 'me', 'accountant'], response());
    const { result } = renderHook(() => useAccountingPermissions(), { wrapper });
    expect(apiGet).not.toHaveBeenCalled();
    expect(result.current.can('EXPENSE_POST')).toBe(false);
  });
});
