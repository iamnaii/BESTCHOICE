# ช่องว่างของ E2E เดิมที่ยังไม่ปิด

ผล read-only code review: 10 skipped cases เป็นช่องว่างของชุดทดสอบ ไม่ใช่ผลผ่าน
และยังไม่ใช่ข้อผิดพลาดของผลิตภัณฑ์ที่ยืนยันแล้วทั้งหมด

| กลุ่ม | จำนวน | สาเหตุที่พบ | งานถัดไป |
| --- | ---: | --- | --- |
| Contract template | 2 | direct API calls ไม่ส่ง Bearer header | ใช้ getRoleAuthHeaders('OWNER') ทั้ง 4 calls; assert response ก่อนอ่าน template |
| PaySolutions accounting | 1 | GET /payments ไม่มี และ Payment ไม่มี paymentNumber | ใช้ contract payment/journal endpoints; ทำ synthetic signed webhook ใน harness และตรวจ metadata.paymentId/idempotency |
| Contract activation accounting | 1 | seed สร้าง ACTIVE โดยไม่ผ่าน activation journal | activate dedicated fixture จริง แล้วตรวจ journal ตาม contract ID; ไม่เทียบ latest 200 ของทั้งระบบ |
| Period close | 1 | เป็น skipped placeholder และ body ยังไม่ implement | seed REVIEW period เก่าที่ไม่รบกวนงานอื่น; ทดสอบ reject ไม่มีเหตุผลและ OWNER force-close พร้อม audit record |
| Finance receivable contact | 2 | ไม่มี external-finance receivable/contact ที่ตรงเงื่อนไข | แยก clean/broken fixtures, ตรวจ note/last contacted และกรองด้วย ID ที่ทราบแน่นอน |
| Used invite | 1 | ไม่มี invite ที่ usedAt ถูกตั้งแล้ว | seed hashed synthetic token ที่หมดสิทธิ์ใช้ แต่ยังไม่หมดเวลา; ตรวจ reject และไม่มี email/token ใหม่ |
| Promise lifecycle/supersede | 2 | promise seed คนละสาขากับ manager/ไม่มี settlementDate; การเลือกแถวและคิวหลังบันทึกไม่แน่นอน | ใช้ contract แยกต่อเคสใน branch002, deadline เหมาะสม; ตรวจ persisted slots/rescheduleCount/superseded/broken count |

`system-e2e.audit-spec.ts` ใช้ standard seed และไม่ได้เรียก `seedSystemUi`.
ต้องเพิ่ม dedicated business seed ภายใต้ disposable-runtime guard พร้อม manifest
IDs สำหรับแต่ละ test เพราะ suite ทำงานขนานกัน ห้ามใช้ `.first()` ของข้อมูลที่
หลาย tests เปลี่ยนร่วมกัน และห้าม seed journal สำเร็จเองแล้วอ้างว่าผ่าน webhook
หรือ activation behavior

Assertions เดิมบางจุดรับได้ทั้งผลตรงข้าม/ตารางว่าง/ปิด dialog โดยไม่ตรวจข้อมูล
การปิดช่องว่างเหล่านี้ต้องแก้ assertion ด้วย ไม่ใช่เพียงยกเลิก test.skip
ไม่จำเป็นต้องขอสิทธิ์ production หรือข้อมูลจริงเพื่อทดสอบในฐานแยกนี้
