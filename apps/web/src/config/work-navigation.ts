import { DollarSign, FileCheck, MessageSquareMore, Plus, ShoppingCart } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Names shared by the sidebar, search, page titles and staff start screen. */
export const NAV_LABELS = {
  home: 'หน้าหลัก',
  sales: 'ขายสินค้า',
  customers: 'ลูกค้า',
  contracts: 'สัญญาผ่อนชำระ',
  payments: 'รับชำระค่างวด',
  stock: 'คลังสินค้า',
  crm: 'ติดตามลูกค้า',
  chat: 'แชทลูกค้า',
} as const;

export interface WorkAction {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  keywords: string;
  roles?: string[];
}

// Keep endpoint/route restrictions here so start cards and search agree.
export const quickActions: WorkAction[] = [
  {
    id: 'contract',
    label: 'ทำสัญญาผ่อน',
    description: 'เลือกสินค้า ลูกค้า และแผนผ่อน ก่อนตรวจทานสัญญา',
    path: '/contracts/create',
    icon: FileCheck,
    keywords: 'new contract สร้างสัญญาใหม่ ทำสัญญา ผ่อน',
    roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  },
  {
    id: 'customer',
    label: 'เพิ่มลูกค้าใหม่',
    description: 'บันทึกข้อมูลลูกค้าสำหรับการขายและติดต่อ',
    path: '/customers?new=1',
    icon: Plus,
    keywords: 'new customer เพิ่ม ลูกค้า เครดิต',
    roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  },
  {
    id: 'sale',
    label: NAV_LABELS.sales,
    description: 'เลือกสินค้าและลูกค้า แล้วบันทึกการขาย',
    path: '/pos',
    icon: ShoppingCart,
    keywords: 'sell ขาย pos ขายของ',
    roles: ['OWNER', 'BRANCH_MANAGER', 'SALES'],
  },
  {
    id: 'payment',
    label: NAV_LABELS.payments,
    description: 'ค้นหาสัญญาและตรวจยอดก่อนบันทึกรับชำระ',
    path: '/payments',
    icon: DollarSign,
    keywords: 'record payment บันทึกชำระเงิน รับชำระ จ่าย',
    roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'],
  },
  {
    id: 'chat',
    label: 'ตอบแชทลูกค้า',
    description: 'เปิดบทสนทนา อ่านประวัติ และตอบลูกค้า',
    path: '/inbox',
    icon: MessageSquareMore,
    keywords: 'chat inbox รวมแชท แชทลูกค้า ตอบ',
    roles: ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES'],
  },
];

const HOME_ACTION_IDS = ['sale', 'contract', 'payment', 'chat'];

export function homeActionsForRole(role: string): WorkAction[] {
  if (!['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES'].includes(role)) {
    return [];
  }
  return HOME_ACTION_IDS.flatMap((id) =>
    quickActions.filter(
      (action) => action.id === id && (!action.roles || action.roles.includes(role)),
    ),
  );
}
