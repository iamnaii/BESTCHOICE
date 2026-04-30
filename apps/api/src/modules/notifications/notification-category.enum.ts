export enum NotificationCategory {
  DUNNING = 'DUNNING',             // ทวงถามหนี้ — strict + frequency cap
  REMINDER = 'REMINDER',           // เตือนก่อนงวด — strict windows + PDPA, no cap
  TRANSACTIONAL = 'TRANSACTIONAL', // ใบเสร็จ — bypassed
  STAFF = 'STAFF',                 // staff alerts — bypass time windows
  MARKETING = 'MARKETING',         // promo — strict + opt-in
}

export const COMPLIANCE_CHECKED_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
  NotificationCategory.REMINDER,
  NotificationCategory.MARKETING,
]);

export const FREQUENCY_CAP_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
]);
