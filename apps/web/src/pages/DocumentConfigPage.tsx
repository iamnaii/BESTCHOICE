/**
 * P4-SP3 — DocumentConfigPage (tabbed shell)
 *
 * Rewrites the P2-SP2 single-section doc-number config into a 9-tab UI:
 *   Tab 0: 'numbering'        — เลขที่/รูปแบบทั่วไป (original P2-SP2 content)
 *   Tabs 1-8: per-doc-type   — writes to doc_config_<key> SystemConfig keys
 *
 * URL ?tab=<key> is bookmarkable and synced via useSearchParams.
 */

import { useSearchParams } from 'react-router';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FileText } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import NumberingConfigTab from '@/pages/settings/NumberingConfigTab';
import DocTypeConfigForm from '@/pages/settings/DocTypeConfigForm';

const TAB_CONFIG: { key: string; label: string; category: 'general' | 'revenue' | 'expense' }[] =
  [
    { key: 'numbering', label: 'เลขที่/รูปแบบทั่วไป', category: 'general' },
    { key: 'deposit_receipt', label: 'ใบรับเงินมัดจำ', category: 'revenue' },
    { key: 'receipt', label: 'ใบเสร็จรับเงิน', category: 'revenue' },
    { key: 'credit_note', label: 'ใบลดหนี้', category: 'revenue' },
    { key: 'purchase_order', label: 'ใบสั่งซื้อ (PO)', category: 'expense' },
    { key: 'expense_doc', label: 'ค่าใช้จ่าย', category: 'expense' },
    { key: 'credit_note_received', label: 'รับใบลดหนี้', category: 'expense' },
    { key: 'payment_summary', label: 'ใบรวมจ่าย', category: 'expense' },
    { key: 'asset_purchase', label: 'ซื้อสินทรัพย์', category: 'expense' },
  ];

export default function DocumentConfigPage() {
  useDocumentTitle('ตั้งค่าเอกสาร');
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('tab') ?? 'numbering';

  return (
    <div className="space-y-6">
      <PageHeader
        title="ตั้งค่าเอกสาร"
        subtitle="กำหนด prefix, รูปแบบเลขที่ และตัวเลือกต่อประเภทเอกสาร"
        icon={<FileText className="size-5" aria-hidden="true" />}
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) => setParams({ tab: v }, { replace: true })}
      >
        <TabsList className="flex-wrap h-auto">
          {TAB_CONFIG.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Tab 0: Numbering — preserves original P2-SP2 functionality */}
        <TabsContent value="numbering">
          <NumberingConfigTab />
        </TabsContent>

        {/* Tabs 1-8: per-doc-type forms */}
        {TAB_CONFIG.filter((t) => t.key !== 'numbering').map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <DocTypeConfigForm typeKey={t.key} label={t.label} category={t.category} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
