import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * ลงเวลาทำงาน (ก้อน 10 D3) — รูปข้อมูลต้องตรงกับ `AttendanceController` / `AttendanceDevicesController` ฝั่ง API
 */
export type TodayStatus = 'ON_TIME' | 'LATE' | 'NOT_IN' | 'DAY_OFF' | 'LEAVE' | 'SHOP_CLOSED' | 'MISSING_OUT';
export type CellStatus = TodayStatus | 'ABSENT' | 'UNAVAILABLE' | 'NONE';
export type DayKind = 'WORK' | 'DAY_OFF' | 'LEAVE_SICK' | 'LEAVE_PERSONAL' | 'LEAVE_OTHER' | 'SHOP_CLOSED';

export interface ScheduleRules {
  workStart: string;
  workEnd: string;
  lateGraceMinutes: number;
}

export interface TodayRow {
  userId: string;
  nickname: string;
  name: string;
  role: string;
  hasPin: boolean;
  visiting: boolean;
  dayId: string | null;
  dayKind: DayKind;
  status: TodayStatus;
  clockIn: string | null;
  clockOut: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  otHours: number;
  flags: string[];
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
  note: string | null;
}

export interface TodayResult {
  date: string;
  rules: ScheduleRules;
  rows: TodayRow[];
  kpi: { staff: number; present: number; onTime: number; late: number; absentSoFar: number; off: number; leave: number; flagged: number };
}

export interface MonthCell {
  dayId: string | null;
  dayKind: DayKind;
  status: CellStatus;
  clockIn: string | null;
  clockOut: string | null;
  lateMinutes: number;
  otHours: number;
  flags: string[];
  clockInPunchId: string | null;
  clockOutPunchId: string | null;
}

export interface MonthSummary {
  workDays: number;
  lateCount: number;
  lateMinutes: number;
  absent: number;
  leave: number;
  otHours: number;
}

export interface MonthRow {
  userId: string;
  nickname: string;
  name: string;
  role: string;
  hasPin: boolean;
  visiting: boolean;
  cells: Record<string, MonthCell>;
  summary: MonthSummary;
}

export interface MonthResult {
  month: string;
  days: string[];
  rows: MonthRow[];
}

export interface MeResult {
  month: string;
  rows: Array<MonthCell & { date: string; correctedCount: number }>;
  summary: MonthSummary;
}

export interface AttendanceDevice {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  status: 'ACTIVE' | 'REVOKED' | 'LOCKED';
  lastSeenAt: string | null;
  lastIp: string | null;
  lastUserAgent: string | null;
  pinLockedUntil: string | null;
  createdAt: string;
}

export interface AttendanceSettings extends ScheduleRules {
  photoRetentionDays: number;
  branches: Array<{ branchId: string; branchName: string; workStart: string | null; workEnd: string | null }>;
}

export const ATTENDANCE_KEY = ['attendance'] as const;

export function useAttendanceToday(branchId: string | undefined, date?: string) {
  return useQuery<TodayResult>({
    queryKey: [...ATTENDANCE_KEY, 'today', branchId, date ?? ''],
    queryFn: async () => (await api.get('/attendance/today', { params: { branchId, date: date || undefined } })).data,
    enabled: !!branchId,
    refetchInterval: 60_000,
  });
}

export function useAttendanceMonth(branchId: string | undefined, month: string) {
  return useQuery<MonthResult>({
    queryKey: [...ATTENDANCE_KEY, 'month', branchId, month],
    queryFn: async () => (await api.get('/attendance/month', { params: { branchId, month } })).data,
    enabled: !!branchId && !!month,
    placeholderData: (previous) => previous,
  });
}

export function useAttendanceMe(month: string) {
  return useQuery<MeResult>({
    queryKey: [...ATTENDANCE_KEY, 'me', month],
    queryFn: async () => (await api.get('/attendance/me', { params: { month } })).data,
  });
}

export function useCorrectDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { dayId: string; clockIn?: string; clockOut?: string | null; dayKind?: DayKind; reason: string }) =>
      (await api.patch(`/attendance/days/${input.dayId}`, { clockIn: input.clockIn, clockOut: input.clockOut, dayKind: input.dayKind, reason: input.reason })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY }),
  });
}

export function useSetDayKinds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { branchId: string; entries: Array<{ userId: string; date: string; dayKind: DayKind }> }) => (await api.put('/attendance/day-kinds', input)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY }),
  });
}

export function useClearConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dayId: string) => (await api.post(`/attendance/days/${dayId}/clear-conflict`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY }),
  });
}

export function useAttendanceDevices() {
  return useQuery<AttendanceDevice[]>({
    queryKey: [...ATTENDANCE_KEY, 'devices'],
    queryFn: async () => (await api.get('/attendance/devices')).data,
  });
}

export function useAttendanceSettings() {
  return useQuery<AttendanceSettings>({
    queryKey: [...ATTENDANCE_KEY, 'settings'],
    queryFn: async () => (await api.get('/attendance/settings')).data,
  });
}

export function useIssueRegistrationCode() {
  return useMutation({
    mutationFn: async (branchId: string) => (await api.post('/attendance/devices/registration-code', { branchId })).data as { code: string; expiresAt: string },
  });
}

export function useDeviceAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; action: 'revoke' | 'unlock' }) => (await api.post(`/attendance/devices/${input.id}/${input.action}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ATTENDANCE_KEY, 'devices'] }),
  });
}

export function useUpdateAttendanceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ScheduleRules> & { photoRetentionDays?: number; branches?: Array<{ branchId: string; workStart?: string | null; workEnd?: string | null }> }) =>
      (await api.patch('/attendance/settings', input)).data as AttendanceSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ATTENDANCE_KEY, 'settings'] }),
  });
}

/** รูปหลักฐาน: API stream ไบต์ผ่าน JWT — โหลดเป็น blob URL (ไม่มี signed URL บน local) */
export async function fetchPunchPhotoUrl(punchId: string): Promise<string> {
  const res = await api.get(`/attendance/punches/${punchId}/photo`, { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}
