# Sidemenu & Navigation Redesign

> Role-based menu + Flow-based grouping + Chat on TopBar

## Problem

เมนูปัจจุบันจัดตาม "ประเภทข้อมูล" (8 sections, 40+ items) แต่พนักงานทุก role คิดตาม "flow งาน" — ทำให้ต้อง click ข้าม section ไปมาตลอด เช่น SALES ต้องกระโดดระหว่าง "ขาย" → "สัญญา" → "การเงิน" แค่จะปิดการขาย 1 รายการ

## Decisions

| หัวข้อ | ก่อน | หลัง |
|--------|------|------|
| Sidebar | เมนูเดียวกันทุก role (ซ่อนตามสิทธิ์) | แต่ละ role เห็นเมนูคนละชุด |
| กลุ่มเมนู | จัดตามประเภทข้อมูล (8 sections) | จัดตาม flow งานจริง (3-6 sections ต่อ role) |
| แชท (Inbox) | อยู่ใน sidebar กลุ่ม "แชท & CRM" | ย้ายไป TopBar ขวาบน (ไอคอน + unread badge) |
| Mobile Bottom Nav | เหมือนกันทุก role (Home, POS, สัญญา, ชำระ, เพิ่มเติม) | แยกตาม role — 4 ปุ่มหลัก + "เพิ่มเติม" |
| Collapsed sidebar | 70px icon rail | คงเดิม |

## Sidebar per Role

### SALES — พนักงานขาย (9 เมนู)

**งานขาย**
| เมนู | Route | Icon |
|-------|-------|------|
| ขายของ (POS) | `/pos` | ShoppingCart |
| ลูกค้า | `/customers` | Users |
| ตรวจเครดิต | `/credit-checks` | UserSearch |
| รับซื้อมือสอง | `/trade-in` | Smartphone |

**สัญญา & ชำระ**
| เมนู | Route | Icon |
|-------|-------|------|
| สัญญาผ่อนชำระ | `/contracts` | FileCheck |
| รับชำระค่างวด | `/payments` | HandCoins |

**เครื่องมือ**
| เมนู | Route | Icon |
|-------|-------|------|
| สต็อกสินค้า | `/stock` | Warehouse |
| ค่าคอมมิชชัน | `/commissions` | Coins |
| CRM Pipeline | `/crm` | Kanban |

### BRANCH_MANAGER — ผจก.สาขา (13 เมนู)

**ภาพรวม**
| เมนู | Route | Icon |
|-------|-------|------|
| Dashboard | `/` | LayoutDashboard |
| ยอดขาย | `/sales` | TrendingUp |

**ขาย & สัญญา**
| เมนู | Route | Icon |
|-------|-------|------|
| ขายของ (POS) | `/pos` | ShoppingCart |
| ลูกค้า | `/customers` | Users |
| สัญญาผ่อนชำระ | `/contracts` | FileCheck |
| รับชำระค่างวด | `/payments` | HandCoins |

**คลัง & จัดซื้อ**
| เมนู | Route | Icon |
|-------|-------|------|
| สต็อกสินค้า | `/stock` | Warehouse |
| โอนสินค้า | `/stock/transfers` | Truck |
| สั่งซื้อ (PO) | `/purchase-orders` | ClipboardList |
| ผู้ขาย | `/suppliers` | Building2 |

**ติดตาม & CRM**
| เมนู | Route | Icon |
|-------|-------|------|
| ค้างชำระ | `/overdue` | AlertTriangle |
| CRM Pipeline | `/crm` | Kanban |
| รายงาน | `/reports` | BarChart3 |

### FINANCE_MANAGER — ผจก.การเงิน (13 เมนู)

**ภาพรวม**
| เมนู | Route | Icon |
|-------|-------|------|
| Dashboard | `/` | LayoutDashboard |
| Finance Portfolio | `/finance-portfolio` | CircleDollarSign |

**รับชำระ & สัญญา**
| เมนู | Route | Icon |
|-------|-------|------|
| สัญญาผ่อนชำระ | `/contracts` | FileCheck |
| รับชำระค่างวด | `/payments` | HandCoins |
| เงินรับจาก FINANCE | `/finance-receivable` | Banknote |
| ใบเสร็จ | `/receipts` | FileText |

**ติดตามหนี้**
| เมนู | Route | Icon |
|-------|-------|------|
| ลูกค้าค้างชำระ | `/overdue` | AlertTriangle |
| Collection Dashboard | `/collection-dashboard` | BarChart3 |
| เปลี่ยนเครื่อง | `/exchange` | RefreshCw |
| ยึดคืนเครื่อง | `/repossessions` | Lock |

**การเงิน**
| เมนู | Route | Icon |
|-------|-------|------|
| ค่าคอมมิชชัน | `/commissions` | Coins |
| รายจ่าย | `/expenses` | Receipt |
| กำไร-ขาดทุน | `/profit-loss` | PieChart |

### ACCOUNTANT — ฝ่ายบัญชี (12 เมนู)

**งานประจำวัน**
| เมนู | Route | Icon |
|-------|-------|------|
| รับชำระค่างวด | `/payments` | HandCoins |
| ใบเสร็จ | `/receipts` | FileText |
| เงินรับจาก FINANCE | `/finance-receivable` | Banknote |
| บันทึกรายจ่าย | `/expenses` | Receipt |

**รายงาน & ภาษี**
| เมนู | Route | Icon |
|-------|-------|------|
| กำไร-ขาดทุน | `/profit-loss` | PieChart |
| ภาษี | `/tax-reports` | Calculator |
| รายงาน | `/reports` | BarChart3 |
| สินทรัพย์ | `/assets` | Landmark |

**ปิดบัญชี & ตรวจสอบ**
| เมนู | Route | Icon |
|-------|-------|------|
| ปิดบัญชีรายเดือน | `/monthly-close` | CalendarDays |
| ผังบัญชี | `/settings/chart-of-accounts` | ClipboardList |
| PEAK Sync | `/settings/peak-sync` | Plug |
| ตรวจสอบบัญชี | `/financial-audit` | ClipboardList |

### OWNER — เจ้าของ (ทุกเมนู)

**ภาพรวม**
| เมนู | Route | Icon |
|-------|-------|------|
| Dashboard | `/` | LayoutDashboard |
| รายงาน | `/reports` | BarChart3 |
| กำไร-ขาดทุน | `/profit-loss` | PieChart |
| Ads & ROI | `/ads` | Target |

**หน้าร้าน**
| เมนู | Route | Icon |
|-------|-------|------|
| ขายของ (POS) | `/pos` | ShoppingCart |
| ลูกค้า | `/customers` | Users |
| ตรวจเครดิต | `/credit-checks` | UserSearch |
| รับซื้อมือสอง | `/trade-in` | Smartphone |
| สต็อกสินค้า | `/stock` | Warehouse |
| โอนสินค้า | `/stock/transfers` | Truck |
| สั่งซื้อ (PO) | `/purchase-orders` | ClipboardList |
| ผู้ขาย | `/suppliers` | Building2 |

**สัญญา & การเงิน**
| เมนู | Route | Icon |
|-------|-------|------|
| สัญญาผ่อนชำระ | `/contracts` | FileCheck |
| รับชำระค่างวด | `/payments` | HandCoins |
| เงินรับจาก FINANCE | `/finance-receivable` | Banknote |
| Finance Portfolio | `/finance-portfolio` | CircleDollarSign |
| ใบเสร็จ | `/receipts` | FileText |
| ค่าคอมมิชชัน | `/commissions` | Coins |
| รายจ่าย | `/expenses` | Receipt |

**ติดตามหนี้**
| เมนู | Route | Icon |
|-------|-------|------|
| ลูกค้าค้างชำระ | `/overdue` | AlertTriangle |
| Collection Dashboard | `/collection-dashboard` | BarChart3 |
| เปลี่ยนเครื่อง | `/exchange` | RefreshCw |
| ยึดคืนเครื่อง | `/repossessions` | Lock |

**บัญชี & ภาษี**
| เมนู | Route | Icon |
|-------|-------|------|
| ภาษี | `/tax-reports` | Calculator |
| ปิดบัญชีรายเดือน | `/monthly-close` | CalendarDays |
| ผังบัญชี | `/settings/chart-of-accounts` | ClipboardList |
| ตรวจสอบบัญชี | `/financial-audit` | ClipboardList |
| สินทรัพย์ | `/assets` | Landmark |
| PEAK Sync | `/settings/peak-sync` | Plug |

**ตั้งค่า & ระบบ**
| เมนู | Route | Icon |
|-------|-------|------|
| ตั้งค่าระบบ | `/settings` | Settings |
| ผู้ใช้ | `/users` | UserCog |
| สาขา | `/branches` | Building2 |
| บริษัท | `/settings/companies` | Building2 |
| ตั้งราคา | `/settings/pricing-templates` | CircleDollarSign |
| แบบสัญญา | `/contract-templates` | FileCheck |
| โปรโมชัน | `/promotions` | BadgePercent |
| Dunning | `/settings/dunning` | Bell |
| PDPA | `/pdpa` | Shield |
| Audit Log | `/audit-logs` | ScrollText |
| CRM Pipeline | `/crm` | Kanban |
| Chat Analytics | `/chat-analytics` | BarChart3 |
| Canned Responses | `/canned-responses` | MessageSquareMore |
| Channel Settings | `/settings/channels` | Plug |

## TopBar Chat

แชท (Inbox) ย้ายจาก sidebar มาอยู่ TopBar ขวาบน:

- **ตำแหน่ง**: ขวาบน ข้างไอคอน notification bell
- **แสดง**: ไอคอน MessageSquareMore + unread count badge (สีแดง)
- **คลิก**: navigate ไปหน้า `/inbox`
- **Badge**: ใช้ `useUnreadChat()` hook เดิม, cap ที่ "99+"
- **Role ที่เห็น**: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES (ACCOUNTANT ไม่เห็น — ไม่ใช่ flow งาน)

## Mobile Bottom Nav per Role

ทุก role มี 5 ปุ่ม: 4 ปุ่มหลัก (ตาม flow ที่ใช้บ่อยสุด) + "เพิ่มเติม" (เปิด sidebar sheet)

| Role | ปุ่ม 1 | ปุ่ม 2 | ปุ่ม 3 | ปุ่ม 4 | ปุ่ม 5 |
|------|--------|--------|--------|--------|--------|
| SALES | POS | ลูกค้า | สัญญา | แชท (badge) | เพิ่มเติม |
| BRANCH_MGR | Dashboard | สต็อก | สัญญา | แชท (badge) | เพิ่มเติม |
| FINANCE_MGR | Dashboard | ค้างชำระ | ชำระ | แชท (badge) | เพิ่มเติม |
| ACCOUNTANT | ชำระ | ใบเสร็จ | รายจ่าย | แชท (badge) | เพิ่มเติม |
| OWNER | Dashboard | รายงาน | Collection | แชท (badge) | เพิ่มเติม |

หมายเหตุ: แชทอยู่ใน bottom nav บน mobile (นิ้วโป้งถึง) แทนที่จะอยู่ TopBar อย่างเดียว

## Implementation Notes

### Menu Configuration

สร้าง menu config เป็น data structure แยกจาก component:

```typescript
// apps/web/src/config/menu.ts

interface MenuItem {
  label: string;
  route: string;
  icon: LucideIcon;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

interface BottomNavItem {
  label: string;
  route: string;
  icon: LucideIcon;
  showBadge?: 'unreadChat';
}

type RoleMenuConfig = {
  sidebar: MenuSection[];
  bottomNav: BottomNavItem[];
};

const MENU_CONFIG: Record<UserRole, RoleMenuConfig> = {
  SALES: { sidebar: [...], bottomNav: [...] },
  BRANCH_MANAGER: { sidebar: [...], bottomNav: [...] },
  FINANCE_MANAGER: { sidebar: [...], bottomNav: [...] },
  ACCOUNTANT: { sidebar: [...], bottomNav: [...] },
  OWNER: { sidebar: [...], bottomNav: [...] },
};
```

### Files to Modify

1. **New**: `apps/web/src/config/menu.ts` — menu configuration per role
2. **Modify**: `apps/web/src/components/layout/Sidebar.tsx` — consume role-based config instead of hardcoded sections
3. **Modify**: `apps/web/src/components/layout/TopBar.tsx` — add chat icon with unread badge
4. **Modify**: `apps/web/src/components/layout/MobileBottomNav.tsx` — consume role-based bottom nav config
5. **Modify**: `apps/web/src/components/layout/MobileSidebar.tsx` — same menu config as desktop sidebar

### What Stays the Same

- All routes and pages — no route changes
- ProtectedRoute role guards — still enforced at route level
- Sidebar collapsed/expanded behavior (70px / 264px)
- Sidebar popover on hover (collapsed mode)
- Sidebar user section (footer)
- Page content and functionality

### Pages Not in Any Role Menu

These pages are accessible via direct URL or in-page navigation but not shown in any sidebar menu. This is intentional — they are either sub-pages, settings sub-routes, or rarely used:

- `/contracts/create` — accessed from contracts page
- `/contracts/:id` — accessed from contracts list
- `/contracts/:id/sign` — accessed from contract detail
- `/customers/:id` — accessed from customers list
- `/suppliers/:id` — accessed from suppliers list
- `/products/create`, `/products/:id` — accessed from stock page
- `/payments/import-csv` — accessed from payments page
- `/stock/alerts`, `/stock/adjustments`, `/stock/count`, `/stock/workflow` — accessed from stock page tabs
- `/inspections`, `/inspections/:id` — accessed from stock/trade-in flow
- `/settings/*` sub-pages (interest-config, line-oa, sms, etc.) — accessed from settings page
- `/chatbot-finance/*` sub-pages — accessed from chatbot main page
- `/stickers` — accessed from stock/product detail
- `/document-dashboard` — OWNER only, low frequency
- `/todos` — accessible via notification/TopBar
- `/notifications` — accessible via TopBar bell icon
- `/system-status`, `/migration`, `/webhooks`, `/analytics` — OWNER admin, low frequency

### Edge Cases

- **User with no role**: Show empty sidebar with only user profile — should not happen in practice
- **Role change**: Menu updates on next page load (role comes from AuthContext)
- **Deep link**: User can still navigate to any authorized route via URL — sidebar just highlights the active item if it exists in their menu

## Future: Pain Points (แยก spec ถัดไป)

Pain points ที่จะแก้หลัง sidemenu redesign เสร็จ:

### Spec 2: Chat + Sales Efficiency
- พนักงานขายตอบแชทช้า / ไม่มีข้อมูลพร้อมตอบ / ไม่มี sales script
- ไม่รู้ว่าโฆษณาไหน convert จริง / cost per unit sold
- ปัจจุบันไม่ได้ติดตาม ads ROI เลย

### Spec 3: MDM Auto-Unlock
- ลูกค้าจ่ายเงินแล้วแต่เครื่องยังล็อค — พนักงานต้องไปกด PJ-Soft manual ทุกครั้ง
- FINANCE ตอบแชทช้าเกิน 2 นาที เพราะต้องทำหลายขั้นตอน
