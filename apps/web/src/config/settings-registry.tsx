import { lazy, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, Users, BarChart3, Wallet, Smartphone, MessageSquare, Sparkles, ShieldCheck, Plug } from 'lucide-react';

// Navigation/search read this registry too: defer page code until its item is rendered.
const CompanySettingsPage = lazy(() => import('@/pages/CompanySettingsPage'));
const AccountRolesPage = lazy(() => import('@/pages/AccountRolesPage'));
const IntegrationHubPage = lazy(() => import('@/pages/IntegrationHubPage'));
const MdmTestPage = lazy(() => import('@/pages/MdmTestPage'));
const LineOaSettingsPage = lazy(() => import('@/pages/LineOaSettingsPage'));
const LineGreetingPage = lazy(() => import('@/pages/LineGreetingPage'));
const SmsTemplatesPage = lazy(() => import('@/pages/SmsTemplatesPage'));
const ChannelSettingsPage = lazy(() => import('@/pages/ChannelSettingsPage'));
const DunningSettingsPage = lazy(() => import('@/pages/DunningSettingsPage'));
const CollectionsSettingsPage = lazy(() => import('@/pages/SettingsPage/CollectionsPage'));
const PricingTemplatesPage = lazy(() => import('@/pages/PricingTemplatesPage'));
const StickersSettingsPage = lazy(() => import('@/pages/SettingsPage/StickersPage'));
const AiAdminPage = lazy(() => import('@/pages/AiAdminPage'));
const AiPersonaPage = lazy(() => import('@/pages/AiPersonaPage'));
const AiSettingsPage = lazy(() => import('@/pages/AiSettingsPage'));
const AiTrainingPage = lazy(() => import('@/pages/AiTrainingPage'));
const AiPerformancePage = lazy(() => import('@/pages/AiPerformancePage'));
const InterestConfigPage = lazy(() => import('@/pages/InterestConfigPage'));
const GfinConfigPage = lazy(() => import('@/pages/GfinConfigPage'));
const PaymentMethodSettingsPage = lazy(() => import('@/pages/PaymentMethodSettingsPage'));
const ChartOfAccountsPage = lazy(() => import('@/pages/ChartOfAccountsPage'));
const PeakSyncPage = lazy(() => import('@/pages/PeakSyncPage'));
const ETaxConfigPage = lazy(() =>
  import('@/pages/ETaxConfigPage').then((m) => ({ default: m.ETaxConfigPage })),
);

// Inline forms keep their existing components and load only in the selected category.
const CompanyTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/CompanyTab').then((m) => ({ default: m.CompanyTab })),
);
const VatTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/VatTab').then((m) => ({ default: m.VatTab })),
);
const PeriodsTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/PeriodsTab').then((m) => ({ default: m.PeriodsTab })),
);
const AttachmentTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/AttachmentTab').then((m) => ({ default: m.AttachmentTab })),
);
const OffsiteBackupTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/OffsiteBackupTab').then((m) => ({ default: m.OffsiteBackupTab })),
);
const PdpaTab = lazy(() =>
  import('@/pages/SettingsPage/tabs/PdpaTab').then((m) => ({ default: m.PdpaTab })),
);
const MakerCheckerToggle = lazy(() =>
  import('@/pages/SettingsPage/components/MakerCheckerToggle').then((m) => ({ default: m.MakerCheckerToggle })),
);
const AccountingPermissionsCard = lazy(() =>
  import('@/pages/SettingsPage/components/AccountingPermissionsCard').then((m) => ({ default: m.AccountingPermissionsCard })),
);
const PaymentApprovalPermissionsCard = lazy(() =>
  import('@/pages/SettingsPage/components/PaymentApprovalPermissionsCard').then((m) => ({ default: m.PaymentApprovalPermissionsCard })),
);
const ReversePermissionCard = lazy(() =>
  import('@/pages/SettingsPage/components/ReversePermissionCard').then((m) => ({ default: m.ReversePermissionCard })),
);
const ReverseReasonsManagementCard = lazy(() =>
  import('@/pages/SettingsPage/components/ReverseReasonsManagementCard').then((m) => ({ default: m.ReverseReasonsManagementCard })),
);
const PettyCashCustodianCard = lazy(() =>
  import('@/pages/SettingsPage/components/PettyCashCustodianCard').then((m) => ({ default: m.PettyCashCustodianCard })),
);
const TestModeToggle = lazy(() =>
  import('@/pages/SettingsPage/components/TestModeToggle').then((m) => ({ default: m.TestModeToggle })),
);
const LateFeeSettingsCard = lazy(() =>
  import('@/pages/SettingsPage/components/LateFeeSettingsCard').then((m) => ({ default: m.LateFeeSettingsCard })),
);

export type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
export type SettingsItemKind = 'inline' | 'route' | 'external';
/** กลุ่มหัวข้อในเมนูตั้งค่า (ใช้จัดคอลัมน์ซ้ายเท่านั้น ไม่กระทบ routing) */
export type SettingsGroupId = 'org' | 'money' | 'sales' | 'system';

export interface SettingsItem {
  id: string;
  label: string;
  keywords?: string[];
  roles: SettingsRole[];
  kind: SettingsItemKind;
  group?: string;                 // หัวข้อกลุ่มในหน้าหมวด
  component?: ComponentType; // kind=inline
  path?: string;                   // kind=external (path ปัจจุบัน) | kind=route (path ใหม่, P2)
}
export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  roles: SettingsRole[];
  /** กลุ่มในเมนูซ้าย — ไม่ระบุ = ตกไปกลุ่ม 'system' (กันหมวดใหม่หายจากเมนู) */
  group?: SettingsGroupId;
  items: SettingsItem[];
}

const ALL: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

export const settingsRegistry: SettingsCategory[] = [
  {
    id: 'company', label: 'บริษัท & สาขา', icon: Building2, roles: ['OWNER'], group: 'org',
    items: [
      { id: 'company-info', label: 'ข้อมูลบริษัท', group: 'บริษัท', roles: ['OWNER'], kind: 'inline', component: CompanyTab, keywords: ['ที่อยู่', 'โลโก้', 'ผู้เซ็น', 'tax id'] },
      { id: 'entities', label: 'บริษัทในเครือ', group: 'บริษัท', roles: ['OWNER'], kind: 'route', component: CompanySettingsPage, path: '/settings/company/entities' },
      { id: 'branches', label: 'สาขา', group: 'สาขา', roles: ['OWNER'], kind: 'external', path: '/branches' },
    ],
  },
  {
    id: 'access', label: 'ผู้ใช้ & สิทธิ์', icon: Users, roles: ['OWNER'], group: 'org',
    items: [
      { id: 'users', label: 'ผู้ใช้ / พนักงาน', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'external', path: '/users' },
      { id: 'account-roles', label: 'บัญชีตาม Role', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'route', component: AccountRolesPage, path: '/settings/access/account-roles' },
      { id: 'maker-checker', label: 'ระบบอนุมัติ 2 ชั้น (Maker-Checker)', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: MakerCheckerToggle, keywords: ['อนุมัติ', 'maker', 'checker'] },
      { id: 'accounting-permissions', label: 'สิทธิ์รายการบัญชีรายรับ–รายจ่าย', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: AccountingPermissionsCard, keywords: ['รายรับ', 'รายจ่าย', 'POST', 'อนุมัติ', 'ยกเลิก'] },
      { id: 'payment-approval-permissions', label: 'สิทธิ์อนุมัติรับชำระ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: PaymentApprovalPermissionsCard, keywords: ['รับชำระ', 'ค่าปรับ', 'อนุโลม', 'คืนเงิน', 'อนุมัติ'] },
      { id: 'reverse-permission', label: 'สิทธิ์กลับรายการสินทรัพย์', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReversePermissionCard, keywords: ['reverse', 'กลับรายการ', 'void'] },
      { id: 'reverse-reasons', label: 'เหตุผลกลับรายการ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReverseReasonsManagementCard },
      { id: 'petty-cash', label: 'ผู้ดูแลเงินสดย่อย', group: 'เงินสด', roles: ['OWNER'], kind: 'inline', component: PettyCashCustodianCard, keywords: ['petty cash', 'เงินสดย่อย'] },
      { id: 'attachment', label: 'นโยบายเอกสารแนบ', group: 'เอกสาร', roles: ['OWNER'], kind: 'inline', component: AttachmentTab, keywords: ['แนบไฟล์', 'attachment'] },
    ],
  },
  {
    id: 'accounting', label: 'บัญชี & ภาษี', icon: BarChart3, roles: ALL, group: 'money',
    items: [
      { id: 'vat', label: 'VAT', group: 'ภาษี', roles: ['OWNER'], kind: 'inline', component: VatTab, keywords: ['ภาษี', '7%', 'มูลค่าเพิ่ม'] },
      { id: 'periods', label: 'งวดบัญชี', group: 'บัญชี', roles: ['OWNER'], kind: 'inline', component: PeriodsTab, keywords: ['ปิดงวด', 'period'] },
      { id: 'chart', label: 'ผังบัญชี / รหัส PEAK', group: 'บัญชี', roles: ALL, kind: 'route', component: ChartOfAccountsPage, path: '/settings/accounting/chart', keywords: ['peak', 'mapping', 'จับคู่', 'รหัสบัญชี'] },
      { id: 'peak-sync', label: 'PEAK sync', group: 'บัญชี', roles: ['OWNER', 'ACCOUNTANT'], kind: 'route', component: PeakSyncPage, path: '/settings/accounting/peak-sync' },
      { id: 'e-tax', label: 'e-Tax', group: 'ภาษี', roles: ['OWNER'], kind: 'route', component: ETaxConfigPage, path: '/settings/accounting/e-tax' },
      { id: 'documents', label: 'เลขที่/รูปแบบเอกสาร', group: 'บัญชี', roles: ['OWNER'], kind: 'external', path: '/settings/document-config' },
    ],
  },
  {
    id: 'finance', label: 'การเงิน & สินเชื่อ', icon: Wallet, roles: ['OWNER', 'FINANCE_MANAGER'], group: 'money',
    items: [
      { id: 'interest', label: 'ดอกเบี้ย', roles: ['OWNER'], kind: 'route', component: InterestConfigPage, path: '/settings/finance/interest' },
      { id: 'late-fee', label: 'ค่าปรับ & เงื่อนไขผ่อน', roles: ['OWNER'], kind: 'inline', component: LateFeeSettingsCard, keywords: ['ค่าปรับ', 'late fee', 'เบี้ยปรับ', 'ปรับล่าช้า', 'ขั้นบันได', 'bracket', 'งวด', 'overdue', 'ติดตามหนี้', 'ปิดก่อนกำหนด'] },
      { id: 'gfin', label: 'GFIN', roles: ['OWNER'], kind: 'route', component: GfinConfigPage, path: '/settings/finance/gfin' },
      { id: 'payment-methods', label: 'ช่องทางชำระเงิน', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'route', component: PaymentMethodSettingsPage, path: '/settings/finance/payment-methods' },
    ],
  },
  {
    id: 'products', label: 'สินค้า & การขาย', icon: Smartphone, roles: ['OWNER'], group: 'sales',
    items: [
      { id: 'pricing', label: 'ตั้งราคา', roles: ['OWNER'], kind: 'route', component: PricingTemplatesPage, path: '/settings/products/pricing' },
      { id: 'stickers', label: 'สติกเกอร์ฉลาก', roles: ['OWNER'], kind: 'route', component: StickersSettingsPage, path: '/settings/products/stickers' },
      { id: 'promotions', label: 'โปรโมชัน', roles: ['OWNER'], kind: 'external', path: '/promotions' },
      { id: 'contract-templates', label: 'แบบสัญญา', roles: ['OWNER'], kind: 'external', path: '/contract-templates' },
    ],
  },
  {
    id: 'comms', label: 'สื่อสารลูกค้า', icon: MessageSquare, roles: ['OWNER', 'FINANCE_MANAGER'], group: 'sales',
    items: [
      { id: 'line-oa', label: 'LINE OA', roles: ['OWNER'], kind: 'route', component: LineOaSettingsPage, path: '/settings/comms/line-oa' },
      { id: 'rich-menu', label: 'Rich Menu', roles: ['OWNER'], kind: 'external', path: '/settings/rich-menu' },
      { id: 'greeting', label: 'ข้อความทักทาย', roles: ['OWNER'], kind: 'route', component: LineGreetingPage, path: '/settings/comms/greeting' },
      { id: 'sms', label: 'SMS templates', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'route', component: SmsTemplatesPage, path: '/settings/comms/sms' },
      { id: 'channels', label: 'ช่องทาง', roles: ['OWNER'], kind: 'route', component: ChannelSettingsPage, path: '/settings/comms/channels' },
      { id: 'dunning', label: 'Dunning', roles: ['OWNER'], kind: 'route', component: DunningSettingsPage, path: '/settings/comms/dunning' },
      { id: 'collections', label: 'ตั้งค่า collections', roles: ['OWNER'], kind: 'route', component: CollectionsSettingsPage, path: '/settings/comms/collections' },
    ],
  },
  {
    id: 'ai', label: 'AI', icon: Sparkles, roles: ['OWNER'], group: 'sales',
    items: [
      { id: 'admin', label: 'AI Admin', roles: ['OWNER'], kind: 'route', component: AiAdminPage, path: '/settings/ai/admin' },
      { id: 'persona', label: 'AI Persona', roles: ['OWNER'], kind: 'route', component: AiPersonaPage, path: '/settings/ai/persona' },
      { id: 'assistant', label: 'AI Assistant', roles: ['OWNER'], kind: 'route', component: AiSettingsPage, path: '/settings/ai/assistant' },
      { id: 'training', label: 'AI Training', roles: ['OWNER'], kind: 'route', component: AiTrainingPage, path: '/settings/ai/training' },
      { id: 'performance', label: 'AI Performance', roles: ['OWNER'], kind: 'route', component: AiPerformancePage, path: '/settings/ai/performance' },
    ],
  },
  {
    id: 'integrations', label: 'เชื่อมต่อ', icon: Plug, roles: ['OWNER', 'ACCOUNTANT'], group: 'system',
    items: [
      { id: 'hub', label: 'การเชื่อมต่อ', roles: ['OWNER', 'ACCOUNTANT'], kind: 'route', component: IntegrationHubPage, path: '/settings/integrations/hub' },
      { id: 'mdm', label: 'MDM', roles: ['OWNER'], kind: 'route', component: MdmTestPage, path: '/settings/integrations/mdm' },
    ],
  },
  {
    id: 'system', label: 'ระบบ & ความปลอดภัย', icon: ShieldCheck, roles: ['OWNER'], group: 'system',
    items: [
      { id: 'test-mode', label: 'โหมดทดสอบ', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: TestModeToggle, keywords: ['test', 'otp', '2fa', 'เครดิต'] },
      { id: 'pdpa', label: 'PDPA', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: PdpaTab, keywords: ['pdpa', 'ข้อมูลส่วนบุคคล', 'encryption'] },
      { id: 'backup', label: 'สำรองข้อมูล', group: 'ข้อมูล', roles: ['OWNER'], kind: 'inline', component: OffsiteBackupTab, keywords: ['backup', 'สำรอง'] },
      { id: 'audit-log', label: 'Audit Log', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/audit-logs' },
      { id: 'system-status', label: 'System Status', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/system-status' },
    ],
  },
];
