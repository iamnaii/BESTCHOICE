import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';

export default function ContactsPage() {
  useDocumentTitle('รายชื่อผู้ติดต่อ');
  return <ContactsTab />;
}
