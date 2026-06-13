import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { EmployeesTab } from '@/pages/SettingsPage/tabs/EmployeesTab';

export default function EmployeesPage() {
  useDocumentTitle('พนักงาน');
  return <EmployeesTab />;
}
