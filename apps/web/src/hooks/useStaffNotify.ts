import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ก้อน 7 A16 — แจ้งพนักงานทาง LINE: รูปข้อมูลของ `GET /staff-notify/rules` ต้องตรงกับ StaffNotifyController ฝั่ง API
 * (catalog มาจาก staff-event-catalog.ts — เว็บไม่ hardcode รายการเหตุการณ์)
 */
export type StaffRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'SALES';
export const STAFF_ROLES: StaffRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES'];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  OWNER: 'เจ้าของ',
  FINANCE_MANAGER: 'ผจก.การเงิน',
  ACCOUNTANT: 'บัญชี',
  BRANCH_MANAGER: 'ผจก.สาขา',
  SALES: 'พนักงานขาย',
};
export const staffRoleLabel = (role: string) => STAFF_ROLE_LABELS[role as StaffRole] ?? role;

export interface StaffNotifyRule {
  enabled: boolean;
  roles: StaffRole[];
  /** ผจก.สาขา/พนักงานขาย ได้เฉพาะเมื่อเหตุการณ์เกิดที่สาขาตัวเอง */
  branchScoped: boolean;
  /** ส่งเข้ากลุ่ม LINE (notifyTargets ใน Integration Hub) ด้วย */
  includeGroup: boolean;
}
export type StaffNotifyRules = Record<string, StaffNotifyRule>;

export interface StaffNotifyCatalogItem {
  key: string;
  group: string;
  label: string;
  description: string;
  defaults: StaffNotifyRule;
}

export interface StaffNotifyUnlinkedUser {
  id: string;
  name: string;
  role: string;
  branchName: string | null;
}

export interface StaffNotifySettings {
  /** Staff OA มี channelToken แล้ว */
  configured: boolean;
  /** จำนวนรหัสในกลุ่ม LINE จาก Integration Hub */
  groupTargets: number;
  webhookUrl: string | null;
  usage: { used: number; cap: number; monthKey: string };
  monthlyCap: number;
  catalog: StaffNotifyCatalogItem[];
  rules: StaffNotifyRules;
  /** พนักงานที่กติกาที่เปิดอยู่ชี้ถึง แต่ยังไม่ผูก LINE */
  unlinkedUsers: StaffNotifyUnlinkedUser[];
}

export interface StaffNotifyResult {
  skipped?: string;
  recipients: number;
  sent: number;
  deduped: number;
  failed: number;
  quotaSkipped: number;
}

export const STAFF_NOTIFY_RULES_KEY = ['staff-notify', 'rules'] as const;

export function useStaffNotifyRules() {
  return useQuery<StaffNotifySettings>({
    queryKey: STAFF_NOTIFY_RULES_KEY,
    queryFn: async () => (await api.get('/staff-notify/rules')).data,
  });
}

export function useSaveStaffNotifyRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rules: StaffNotifyRules) => (await api.put('/staff-notify/rules', { rules })).data as { rules: StaffNotifyRules },
    onSuccess: (res) => {
      queryClient.setQueryData<StaffNotifySettings>(STAFF_NOTIFY_RULES_KEY, (old) => (old && res?.rules ? { ...old, rules: res.rules } : old));
      queryClient.invalidateQueries({ queryKey: STAFF_NOTIFY_RULES_KEY });
    },
  });
}

/** ส่งข้อความตัวอย่างของเหตุการณ์ถึงผู้ใช้ที่ล็อกอิน (ปุ่ม "ส่งทดสอบถึงฉัน") */
export function useStaffNotifyTest() {
  return useMutation({
    mutationFn: async (eventKey: string) => (await api.post('/staff-notify/test', { eventKey })).data as StaffNotifyResult,
  });
}

/** เทียบกติกาสองชุดโดยไม่สนลำดับบทบาท — ใช้นับ "รายการที่ยังไม่ได้บันทึก" */
export function sameStaffNotifyRule(a: StaffNotifyRule | undefined, b: StaffNotifyRule | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.enabled === b.enabled &&
    a.branchScoped === b.branchScoped &&
    a.includeGroup === b.includeGroup &&
    [...a.roles].sort().join(',') === [...b.roles].sort().join(',')
  );
}

// ─── ผูก LINE รายคน (หน้าผู้ใช้ › ไลน์พนักงาน) — สเปก §13.1 ──────────────────────────────────────────

export interface StaffLineLinkCode {
  code: string;
  /** ISO — 15 นาทีหลังสร้าง */
  expiresAt: string;
}

const userDetailKey = (userId: string) => ['users', 'detail', userId] as const;

/** สร้างรหัส 6 หลักให้พนักงานส่งในแชท Staff OA */
export function useIssueStaffLineCode(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/staff-notify/users/${userId}/link-code`)).data as StaffLineLinkCode,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userDetailKey(userId) }),
  });
}

/** ข้อความทดสอบถึงพนักงานคนนั้น (ยืนยันว่าผูกถูกคน) */
export function useStaffLineTest(userId: string) {
  return useMutation({ mutationFn: async () => (await api.post(`/staff-notify/users/${userId}/test`)).data as { ok: true } });
}

export function useUnlinkStaffLine(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.delete(`/staff-notify/users/${userId}/link`)).data as { ok: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userDetailKey(userId) }),
  });
}

/** `U4af4…abcd` — โชว์แค่หัวท้ายของ LINE userId */
export const maskLineUserId = (id: string) => (id.length > 5 ? `${id[0]}…${id.slice(-4)}` : id);
