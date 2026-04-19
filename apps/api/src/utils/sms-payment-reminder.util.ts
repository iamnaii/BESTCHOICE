/**
 * SMS payment-reminder kill-switch.
 *
 * Set env `SMS_PAYMENT_REMINDER_DISABLED=true` to block SMS that notifies
 * customers about installment payments specifically:
 *   - Upcoming-payment reminders (sendPaymentReminders)
 *   - Overdue notices (sendOverdueNotices)
 *   - Dunning escalation SMS fallback when LINE delivery fails
 *
 * Other SMS use cases keep working: OTP, KYC verification, contract
 * activation, manual one-off sends. LINE/broadcast/IN_APP unaffected.
 */
export function isSmsPaymentReminderDisabled(): boolean {
  return process.env.SMS_PAYMENT_REMINDER_DISABLED === 'true';
}
