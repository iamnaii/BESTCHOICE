import { useParams, Navigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { findItem } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

export function SettingsItemRoute() {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { categoryId = '', itemId = '' } = useParams<{ categoryId: string; itemId: string }>();
  const found = findItem(categoryId, itemId);

  // ไม่พบ / ไม่ใช่ route / ไม่มี component / role ไม่ถึง → กลับหน้าหมวด
  if (!found || found.item.kind !== 'route' || !found.item.component || !found.item.roles.includes(role)) {
    return <Navigate to={`/settings/${categoryId}`} replace />;
  }
  const C = found.item.component;
  return <C />;
}
