import { NotificationCategory } from '@prisma/client';
export { NotificationCategory };

export const COMPLIANCE_CHECKED_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
  NotificationCategory.REMINDER,
  NotificationCategory.MARKETING,
]);

export const FREQUENCY_CAP_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.DUNNING,
]);
