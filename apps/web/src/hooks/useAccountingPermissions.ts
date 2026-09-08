import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import type { AccountingPermission, AccountingPermissionsMe } from '@/lib/accounting-permissions';

export function useAccountingPermissions() {
  const { user } = useAuth();
  const eligible = !!user?.id && ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER'].includes(user.role);
  const query = useQuery({
    queryKey: ['accounting-permissions', 'me', user?.id],
    queryFn: async () => (await api.get<AccountingPermissionsMe>('/accounting-permissions/me')).data,
    enabled: eligible,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  return {
    ...query,
    can: (permission: AccountingPermission) => eligible && !query.isFetching && !query.isPending && !query.isError &&
      query.data?.user.id === user?.id && query.data?.permissions.includes(permission) === true,
  };
}
