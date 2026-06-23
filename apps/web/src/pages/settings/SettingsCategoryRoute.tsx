import { useParams } from 'react-router';
import { CategoryPage } from './CategoryPage';

export function SettingsCategoryRoute() {
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  return <CategoryPage categoryId={categoryId} />;
}
