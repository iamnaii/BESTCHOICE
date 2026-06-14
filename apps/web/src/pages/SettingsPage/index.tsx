import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ContactsTab } from './tabs/ContactsTab';
import { CompanyTab } from './tabs/CompanyTab';
import { VatTab } from './tabs/VatTab';
import { PeriodsTab } from './tabs/PeriodsTab';
import { AttachmentTab } from './tabs/AttachmentTab';
import { UsersTab } from './tabs/UsersTab';
import { OffsiteBackupTab } from './tabs/OffsiteBackupTab';
import { PeakMappingTab } from './tabs/PeakMappingTab';
import { PdpaTab } from './tabs/PdpaTab';
import { InternalControlTab } from './tabs/InternalControlTab';

type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
const ALLOWED_ROLES: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

interface TabDef {
  id: string;
  label: string;
  roles: SettingsRole[];
  render: () => React.ReactNode;
}

// master-data ขึ้นก่อน แล้วตามด้วย config (OWNER เท่านั้น)
const TABS: TabDef[] = [
  { id: 'contacts', label: 'ผู้ติดต่อ', roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'], render: () => <ContactsTab /> },
  { id: 'company', label: 'บริษัท', roles: ['OWNER'], render: () => <CompanyTab /> },
  { id: 'vat', label: 'VAT', roles: ['OWNER'], render: () => <VatTab /> },
  { id: 'periods', label: 'งวดบัญชี', roles: ['OWNER'], render: () => <PeriodsTab /> },
  { id: 'attachment', label: 'เอกสารแนบ', roles: ['OWNER'], render: () => <AttachmentTab /> },
  { id: 'users', label: 'ผู้ใช้งาน', roles: ['OWNER'], render: () => <UsersTab /> },
  { id: 'internal-control', label: 'ระบบควบคุม', roles: ['OWNER'], render: () => <InternalControlTab /> },
  { id: 'offsite-backup', label: 'สำรองข้อมูล', roles: ['OWNER'], render: () => <OffsiteBackupTab /> },
  { id: 'peak-mapping', label: 'PEAK', roles: ['OWNER'], render: () => <PeakMappingTab /> },
  { id: 'pdpa', label: 'PDPA', roles: ['OWNER'], render: () => <PdpaTab /> },
];

function readHash(): string {
  return typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
}

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;

  const visibleTabs = useMemo(() => TABS.filter((t) => t.roles.includes(role)), [role]);
  const visibleIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  const idsKey = visibleIds.join(',');

  const [activeTab, setActiveTab] = useState<string>(() => {
    const h = readHash();
    const initialIds = TABS.filter((t) => t.roles.includes(role)).map((t) => t.id);
    return initialIds.includes(h) ? h : (initialIds[0] ?? '');
  });

  // keep activeTab valid for the current role + sync hash
  useEffect(() => {
    const current = visibleIds.includes(activeTab) ? activeTab : (visibleIds[0] ?? '');
    if (current && current !== activeTab) setActiveTab(current);
    if (current && window.location.hash.slice(1) !== current) {
      window.history.replaceState(null, '', `#${current}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, idsKey]);

  // react to back/forward
  useEffect(() => {
    const handler = () => {
      const h = readHash();
      setActiveTab(visibleIds.includes(h) ? h : (visibleIds[0] ?? ''));
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // guard ออก *หลัง* hook ทั้งหมด (กัน rules-of-hooks) — role อื่นเด้ง /
  if (user && !ALLOWED_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
        <TabsList className="grid grid-cols-2 md:grid-flow-col md:auto-cols-fr mb-4">
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTabs.map((t) => (
          <TabsContent key={t.id} value={t.id}>
            {t.render()}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
