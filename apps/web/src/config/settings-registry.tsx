import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Building2, Users, BarChart3, Wallet, Smartphone, MessageSquare, Sparkles, ShieldCheck } from 'lucide-react';
import LineOaSettingsPage from '@/pages/LineOaSettingsPage';
import LineGreetingPage from '@/pages/LineGreetingPage';
import SmsTemplatesPage from '@/pages/SmsTemplatesPage';
import ChannelSettingsPage from '@/pages/ChannelSettingsPage';
import DunningSettingsPage from '@/pages/DunningSettingsPage';
import CollectionsSettingsPage from '@/pages/SettingsPage/CollectionsPage';
import InterestConfigPage from '@/pages/InterestConfigPage';
import GfinConfigPage from '@/pages/GfinConfigPage';
import PaymentMethodSettingsPage from '@/pages/PaymentMethodSettingsPage';
import ChartOfAccountsPage from '@/pages/ChartOfAccountsPage';
import PeakSyncPage from '@/pages/PeakSyncPage';
import { ETaxConfigPage } from '@/pages/ETaxConfigPage';
// inline components (อยู่ที่เดิม — แค่ import มา render)
import { CompanyTab } from '@/pages/SettingsPage/tabs/CompanyTab';
import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';
import { VatTab } from '@/pages/SettingsPage/tabs/VatTab';
import { PeriodsTab } from '@/pages/SettingsPage/tabs/PeriodsTab';
import { AttachmentTab } from '@/pages/SettingsPage/tabs/AttachmentTab';
import { PeakMappingTab } from '@/pages/SettingsPage/tabs/PeakMappingTab';
import { OffsiteBackupTab } from '@/pages/SettingsPage/tabs/OffsiteBackupTab';
import { PdpaTab } from '@/pages/SettingsPage/tabs/PdpaTab';
import { MakerCheckerToggle } from '@/pages/SettingsPage/components/MakerCheckerToggle';
import { ReversePermissionCard } from '@/pages/SettingsPage/components/ReversePermissionCard';
import { ReverseReasonsManagementCard } from '@/pages/SettingsPage/components/ReverseReasonsManagementCard';
import { PettyCashCustodianCard } from '@/pages/SettingsPage/components/PettyCashCustodianCard';
import { TestModeToggle } from '@/pages/SettingsPage/components/TestModeToggle';

export type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
export type SettingsItemKind = 'inline' | 'route' | 'external';

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
  items: SettingsItem[];
}

const ALL: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

export const settingsRegistry: SettingsCategory[] = [
  {
    id: 'company', label: 'บริษัท & สาขา', icon: Building2, roles: ALL,
    items: [
      { id: 'company-info', label: 'ข้อมูลบริษัท', group: 'บริษัท', roles: ['OWNER'], kind: 'inline', component: CompanyTab, keywords: ['ที่อยู่', 'โลโก้', 'ผู้เซ็น', 'tax id'] },
      { id: 'contacts', label: 'สมุดผู้ติดต่อ', group: 'บริษัท', roles: ALL, kind: 'inline', component: ContactsTab, keywords: ['ลูกค้า', 'ผู้ขาย', 'supplier'] },
      { id: 'entities', label: 'บริษัทในเครือ', group: 'บริษัท', roles: ['OWNER'], kind: 'external', path: '/settings/companies' },
      { id: 'branches', label: 'สาขา', group: 'สาขา', roles: ['OWNER'], kind: 'external', path: '/branches' },
    ],
  },
  {
    id: 'access', label: 'ผู้ใช้ & สิทธิ์', icon: Users, roles: ['OWNER'],
    items: [
      { id: 'users', label: 'ผู้ใช้ / พนักงาน', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'external', path: '/users' },
      { id: 'account-roles', label: 'บัญชีตาม Role', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'external', path: '/settings/account-roles' },
      { id: 'maker-checker', label: 'ระบบอนุมัติ 2 ชั้น (Maker-Checker)', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: MakerCheckerToggle, keywords: ['อนุมัติ', 'maker', 'checker'] },
      { id: 'reverse-permission', label: 'สิทธิ์กลับรายการ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReversePermissionCard, keywords: ['reverse', 'กลับรายการ', 'void'] },
      { id: 'reverse-reasons', label: 'เหตุผลกลับรายการ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReverseReasonsManagementCard },
      { id: 'petty-cash', label: 'ผู้ดูแลเงินสดย่อย', group: 'เงินสด', roles: ['OWNER'], kind: 'inline', component: PettyCashCustodianCard, keywords: ['petty cash', 'เงินสดย่อย'] },
      { id: 'attachment', label: 'นโยบายเอกสารแนบ', group: 'เอกสาร', roles: ['OWNER'], kind: 'inline', component: AttachmentTab, keywords: ['แนบไฟล์', 'attachment'] },
    ],
  },
  {
    id: 'accounting', label: 'บัญชี & ภาษี', icon: BarChart3, roles: ALL,
    items: [
      { id: 'vat', label: 'VAT', group: 'ภาษี', roles: ['OWNER'], kind: 'inline', component: VatTab, keywords: ['ภาษี', '7%', 'มูลค่าเพิ่ม'] },
      { id: 'periods', label: 'งวดบัญชี', group: 'บัญชี', roles: ['OWNER'], kind: 'inline', component: PeriodsTab, keywords: ['ปิดงวด', 'period'] },
      { id: 'peak-mapping', label: 'PEAK mapping', group: 'บัญชี', roles: ALL, kind: 'inline', component: PeakMappingTab, keywords: ['peak'] },
      { id: 'chart', label: 'ผังบัญชี', group: 'บัญชี', roles: ALL, kind: 'route', component: ChartOfAccountsPage, path: '/settings/accounting/chart' },
      { id: 'peak-sync', label: 'PEAK sync', group: 'บัญชี', roles: ['OWNER', 'ACCOUNTANT'], kind: 'route', component: PeakSyncPage, path: '/settings/accounting/peak-sync' },
      { id: 'e-tax', label: 'e-Tax', group: 'ภาษี', roles: ['OWNER'], kind: 'route', component: ETaxConfigPage, path: '/settings/accounting/e-tax' },
      { id: 'documents', label: 'เลขที่/รูปแบบเอกสาร', group: 'บัญชี', roles: ['OWNER'], kind: 'external', path: '/settings/document-config' },
    ],
  },
  {
    id: 'finance', label: 'การเงิน & สินเชื่อ', icon: Wallet, roles: ['OWNER', 'FINANCE_MANAGER'],
    items: [
      { id: 'interest', label: 'ดอกเบี้ย', roles: ['OWNER'], kind: 'route', component: InterestConfigPage, path: '/settings/finance/interest' },
      { id: 'gfin', label: 'GFIN', roles: ['OWNER'], kind: 'route', component: GfinConfigPage, path: '/settings/finance/gfin' },
      { id: 'payment-methods', label: 'ช่องทางชำระเงิน', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'route', component: PaymentMethodSettingsPage, path: '/settings/finance/payment-methods' },
    ],
  },
  {
    id: 'products', label: 'สินค้า & การขาย', icon: Smartphone, roles: ['OWNER'],
    items: [
      { id: 'pricing', label: 'ตั้งราคา', roles: ['OWNER'], kind: 'external', path: '/settings/pricing-templates' },
      { id: 'stickers', label: 'สติกเกอร์ฉลาก', roles: ['OWNER'], kind: 'external', path: '/settings/stickers' },
      { id: 'promotions', label: 'โปรโมชัน', roles: ['OWNER'], kind: 'external', path: '/promotions' },
      { id: 'contract-templates', label: 'แบบสัญญา', roles: ['OWNER'], kind: 'external', path: '/contract-templates' },
    ],
  },
  {
    id: 'comms', label: 'สื่อสารลูกค้า', icon: MessageSquare, roles: ['OWNER', 'FINANCE_MANAGER'],
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
    id: 'ai', label: 'AI', icon: Sparkles, roles: ['OWNER'],
    items: [
      { id: 'ai-admin', label: 'AI Admin', roles: ['OWNER'], kind: 'external', path: '/settings/ai-admin' },
      { id: 'ai-persona', label: 'AI Persona', roles: ['OWNER'], kind: 'external', path: '/settings/ai-persona' },
      { id: 'ai-assistant', label: 'AI Assistant', roles: ['OWNER'], kind: 'external', path: '/settings/ai-chat' },
      { id: 'ai-training', label: 'AI Training', roles: ['OWNER'], kind: 'external', path: '/settings/ai-training' },
      { id: 'ai-performance', label: 'AI Performance', roles: ['OWNER'], kind: 'external', path: '/settings/ai-performance' },
    ],
  },
  {
    id: 'system', label: 'ระบบ & ความปลอดภัย', icon: ShieldCheck, roles: ['OWNER', 'ACCOUNTANT'],
    items: [
      { id: 'test-mode', label: 'โหมดทดสอบ', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: TestModeToggle, keywords: ['test', 'otp', '2fa', 'เครดิต'] },
      { id: 'pdpa', label: 'PDPA', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: PdpaTab, keywords: ['pdpa', 'ข้อมูลส่วนบุคคล', 'encryption'] },
      { id: 'backup', label: 'สำรองข้อมูล', group: 'ข้อมูล', roles: ['OWNER'], kind: 'inline', component: OffsiteBackupTab, keywords: ['backup', 'สำรอง'] },
      { id: 'integrations', label: 'การเชื่อมต่อ', group: 'เชื่อมต่อ', roles: ['OWNER', 'ACCOUNTANT'], kind: 'external', path: '/settings/integrations' },
      { id: 'mdm', label: 'MDM', group: 'เชื่อมต่อ', roles: ['OWNER'], kind: 'external', path: '/settings/mdm-test' },
      { id: 'audit-log', label: 'Audit Log', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/audit-logs' },
      { id: 'system-status', label: 'System Status', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/system-status' },
    ],
  },
];
