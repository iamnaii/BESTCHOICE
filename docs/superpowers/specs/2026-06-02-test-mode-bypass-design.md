# Test-Mode Bypass (pre-go-live UAT)

วันที่: 2026-06-02
สถานะ: รออนุมัติ spec จาก owner

## ที่มา
Owner ต้องการทดสอบระบบจริง (ที่ deploy แล้ว) แบบ end-to-end ก่อน go-live โดยไม่ติดขั้นตอนที่ต้องใช้ข้อมูล/อุปกรณ์จริง: เช็คเครดิต + OTP หลายจุด. ยังไม่มีลูกค้าจริงในช่วงนี้ จึง bypass ได้ชั่วคราว แต่ต้องทำเป็น **toggle ที่ปิดได้ + เตือนชัด** ไม่ใช่ลบ control ถาวร.

## หลักการ + ความปลอดภัย
- **toggle เดียวคุม 4 จุด**, OWNER เท่านั้น, default `false`
- ปิด control บน **server จริง** → ต้องมี safety: banner เด่น + audit ตอน toggle + มาร์ค record ที่ bypass + ต้องปิดก่อน go-live
- mirror pattern `CustomerPiiService.isStrictMode/setStrictMode` (SystemConfig, อ่านสดไม่ cache)

## ขอบเขต

### 1. Toggle
- SystemConfig key `TEST_MODE_BYPASS` (`'true'`/`'false'`, default false)
- service helper `TestModeService.isEnabled(): Promise<boolean>` (อ่าน SystemConfig สด) + `setEnabled(boolean)` (upsert + audit)
- endpoint `GET /settings/test-mode` (อ่านสถานะ) + `PUT /settings/test-mode` (OWNER เท่านั้น) → audit string `TEST_MODE_TOGGLED` (`newValue: { enabled }`)
- helper inject ได้ในทุก module ที่ต้อง bypass (อยู่ใน shared module / หรือ provide ผ่าน module ที่เหมาะ)

### 2. จุด bypass 4 จุด (เมื่อ enabled = true)
| จุด | ไฟล์ | พฤติกรรมเมื่อ ON |
|---|---|---|
| customer precheck | `apps/api/src/modules/customers/customer-precheck.service.ts` | คืนผล "ผ่าน" สังเคราะห์ (ไม่ยิงเช็คเครดิตจริง) + เขียน audit `CREDIT_PRECHECK_BYPASSED_TEST_MODE` |
| KYC OTP (เซ็นสัญญา) | `apps/api/src/modules/kyc/kyc.service.ts` `verifyOtp(contractId, otp)` | ผ่านทันที ไม่ตรวจโค้ด + audit `KYC_OTP_BYPASSED_TEST_MODE` (entity=contract) |
| LIFF OTP | `apps/api/src/modules/chatbot-finance/services/verification.service.ts` `verifyOtp(params)` | ผ่านทันที + audit `LIFF_OTP_BYPASSED_TEST_MODE` |
| 2FA login | auth login flow (จุดที่ตรวจ 2FA หลังรหัสผ่าน — implementer หา exact call ใน `auth.service.ts`/`two-factor.service.ts`) | ข้าม step 2FA หลัง password ถูก + audit `LOGIN_2FA_BYPASSED_TEST_MODE` |

- แต่ละจุด: ถ้า `isEnabled()` = false → พฤติกรรมเดิมเป๊ะ (control ทำงานปกติ). ถ้า true → bypass + audit/มาร์ค
- การ bypass แต่ละครั้งเขียน audit (ผ่าน AuditService/Interceptor) เพื่อให้รู้ว่า record ไหนข้าม control → ตามลบ/ตรวจก่อน go-live

### 3. Frontend safety
- **Banner เด่นทั่วแอป** (ใน MainLayout) เมื่อ test-mode ON: สีเตือน (destructive) ข้อความ "⚠️ โหมดทดสอบ — เช็คเครดิต/OTP ถูกปิด ห้ามใช้กับลูกค้าจริง" + ปุ่มลิงก์ไปปิด (OWNER)
- หน้า Settings เพิ่ม toggle "โหมดทดสอบ (ปิดเช็คเครดิต/OTP)" — OWNER เท่านั้น, มีคำเตือน + confirm dialog ตอนเปิด
- Banner อ่านสถานะจาก `GET /settings/test-mode` (react-query, refetch สม่ำเสมอ)

## ไม่ทำ (YAGNI)
- แยก toggle ต่อ step (ใช้ตัวเดียวคุมหมดตามที่ตกลง)
- env-var gate เพิ่ม (toggle SystemConfig + OWNER + banner พอสำหรับช่วง pre-go-live; ถ้าต้องการเข้มกว่าค่อยเพิ่ม env gate ภายหลัง)
- auto-expire toggle (ปิดเอง) — owner ปิดเองตอน go-live (banner ช่วยเตือน)

## ทดสอบ
- API ต่อจุด: `isEnabled=false` → control เดิมทำงาน (test เดิมเขียว) ; `isEnabled=true` → bypass + audit ถูกเขียน
- `TestModeService`: setEnabled upsert + audit ; isEnabled อ่านสด
- endpoint: PUT OWNER-only (role อื่น 403)
- web: banner ขึ้นเมื่อ ON / หายเมื่อ OFF ; settings toggle + confirm

## ⚠️ Runbook go-live
ก่อนเปิดใช้จริง: ปิด `TEST_MODE_BYPASS` → ตรวจ audit `*_BYPASSED_TEST_MODE` หา record ที่สร้างช่วงเทสต์ → ลบข้อมูลทดสอบ → ยืนยัน banner หาย
