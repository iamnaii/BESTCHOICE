import { useParams, useLocation, Navigate } from 'react-router';
import { CategoryPage } from './CategoryPage';

export function SettingsCategoryRoute() {
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const { hash } = useLocation();
  if (categoryId === 'accounting' && hash === '#peak-mapping') {
    return <Navigate to="/settings/accounting/chart?tab=peak" replace />;
  }
  return <CategoryPage categoryId={categoryId} />;
}
