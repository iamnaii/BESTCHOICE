import { useEffect, useState } from 'react';
import { Navigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CompanyTab } from './tabs/CompanyTab';
import { VatTab } from './tabs/VatTab';
import { PeriodsTab } from './tabs/PeriodsTab';
import { AttachmentTab } from './tabs/AttachmentTab';
import { UsersTab } from './tabs/UsersTab';
import { OffsiteBackupTab } from './tabs/OffsiteBackupTab';

const TAB_IDS = ['company', 'vat', 'periods', 'attachment', 'users', 'offsite-backup'] as const;
type TabId = typeof TAB_IDS[number];

function readHash(): TabId {
  const h = (typeof window !== 'undefined' ? window.location.hash.slice(1) : '') as TabId;
  return TAB_IDS.includes(h) ? h : 'company';
}

export default function SettingsPage() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>(readHash());

  // Permission guard — Sprint 2 placed MakerCheckerToggle on this page, so user.role === OWNER assumed for full access
  if (user && user.role !== 'OWNER') {
    return <Navigate to="/" replace />;
  }

  // Sync URL hash <-> activeTab
  useEffect(() => {
    if (window.location.hash.slice(1) !== activeTab) {
      window.history.replaceState(null, '', `#${activeTab}`);
    }
  }, [activeTab]);

  // React to back/forward
  useEffect(() => {
    const handler = () => setActiveTab(readHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="grid grid-cols-2 md:grid-cols-6 mb-4">
          <TabsTrigger value="company">บริษัท</TabsTrigger>
          <TabsTrigger value="vat">VAT</TabsTrigger>
          <TabsTrigger value="periods">งวดบัญชี</TabsTrigger>
          <TabsTrigger value="attachment">เอกสารแนบ</TabsTrigger>
          <TabsTrigger value="users">ผู้ใช้งาน</TabsTrigger>
          <TabsTrigger value="offsite-backup">สำรองข้อมูล</TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab /></TabsContent>
        <TabsContent value="vat"><VatTab /></TabsContent>
        <TabsContent value="periods"><PeriodsTab /></TabsContent>
        <TabsContent value="attachment"><AttachmentTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="offsite-backup"><OffsiteBackupTab /></TabsContent>
      </Tabs>
    </div>
  );
}
