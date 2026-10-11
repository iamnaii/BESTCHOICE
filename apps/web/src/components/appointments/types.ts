export interface Branch {
  id: string;
  name: string;
  location?: string | null;
  phone?: string | null;
}
export interface Slot {
  startsAt: string;
  endsAt: string;
  available: number;
}
export interface Visit {
  id: string;
  reference: string;
  branch: Branch;
  startsAt: string;
  endsAt: string;
  status: string;
  version: number;
}
export interface StaffVisit extends Visit {
  customer: { id: string; name: string };
  staff: { id: string; name: string };
  branchId: string;
  assignmentIssue: boolean;
  creditEligible?: boolean;
}
export interface Selection {
  branchId: string;
  day: string;
  startsAt: string;
}
export const visitStatus: Record<string, string> = {
  BOOKED: 'นัดแล้ว',
  CHECKED_IN: 'มาถึงแล้ว',
  IN_SERVICE: 'กำลังให้บริการ',
  COMPLETED: 'เสร็จสิ้น',
  CANCELED: 'ยกเลิกแล้ว',
  NO_SHOW: 'ไม่มาตามนัด',
};
export const thaiTime = (value: string) =>
  new Date(value).toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
export const thaiDate = (value: string) =>
  new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
export const visitDay = (offset = 0) =>
  new Date(Date.now() + offset * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
