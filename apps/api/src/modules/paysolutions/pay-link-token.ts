/**
 * Task 39 — token ของลิงก์ `/pay/:token` (`PaymentLinkService.createPaymentLink` — `randomBytes(32).toString('hex')`) · แถวติดตาม intent
 * ใช้เลขอ้างอิง 12 หลัก (`Date.now()`) ⇒ ไม่ผ่าน · ใช้ทั้ง DTO ของ `create-intent` และ service (ชั้นที่สอง)
 */
export const PAY_LINK_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
