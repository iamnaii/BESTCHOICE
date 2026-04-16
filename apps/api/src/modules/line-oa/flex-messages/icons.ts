/**
 * Icon URLs for LINE Flex Message — Style C Design System
 * Icons hosted on S3/CDN as PNG (LINE Flex doesn't support inline SVG)
 * Replace BASE_URL with actual S3 bucket URL after upload.
 */
const BASE_URL =
  process.env.ICON_BASE_URL || 'https://storage.googleapis.com/bestchoice-assets/icons';

export const ICONS = {
  CREDIT_CARD: `${BASE_URL}/credit-card.png`,
  DOLLAR_SIGN: `${BASE_URL}/dollar-sign.png`,
  BAR_CHART: `${BASE_URL}/bar-chart.png`,
  CALCULATOR: `${BASE_URL}/calculator.png`,
  CHECK_CIRCLE: `${BASE_URL}/check-circle.png`,
  ALERT_TRIANGLE: `${BASE_URL}/alert-triangle.png`,
  INFO_CIRCLE: `${BASE_URL}/info-circle.png`,
  CLOCK: `${BASE_URL}/clock.png`,
  FILE_TEXT: `${BASE_URL}/file-text.png`,
  LIST: `${BASE_URL}/list.png`,
  RECEIPT: `${BASE_URL}/receipt.png`,
  MESSAGE_CIRCLE: `${BASE_URL}/message-circle.png`,
  PHONE: `${BASE_URL}/phone.png`,
  SMARTPHONE: `${BASE_URL}/smartphone.png`,
  GIFT: `${BASE_URL}/gift.png`,
  MAP_PIN: `${BASE_URL}/map-pin.png`,
  QR_CODE: `${BASE_URL}/qr-code.png`,
  ACTIVITY: `${BASE_URL}/activity.png`,
} as const;
