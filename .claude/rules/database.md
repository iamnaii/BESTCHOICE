# Database Rules (Prisma + PostgreSQL)

## IDs
- ใช้ UUID เสมอ: `id String @id @default(uuid())`
- ห้ามใช้ autoincrement

## Timestamps
โดย default ทุก model ต้องมี 3 fields นี้:
```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
deletedAt DateTime?
```

### Exception patterns (ข้อยกเว้นที่ documented)
- **Immutable audit logs** (AuditLog, DocumentAuditLog, DataAuditLog, WebhookDelivery) — ไม่มี `updatedAt`/`deletedAt` เพราะ immutable by design. Retention handled by dedicated cron
- **One-time tokens** (PasswordResetToken, InviteToken, CustomerAccessToken, ChatbotOtpRequest) — ไม่มี `updatedAt`/`deletedAt` เพราะ use-once + TTL cleanup
- **Idempotency records** (ProcessedWebhookEvent) — มีแค่ `processedAt` เป็น createdAt-equivalent. Immutable, retention via cron
- **Append-only event logs** (ChatMessage, CallLog, BroadcastMessage receipts) — ไม่มี `updatedAt` เพราะ events ไม่แก้หลัง insert

**Rule**: ถ้า model ใหม่ควรยกเว้นต้องมี `///` comment อธิบายเหตุผล เช่น `/// Immutable audit log — updatedAt/deletedAt intentionally omitted`

## Soft Delete
- ใช้ `deletedAt DateTime?` — **ห้าม hard delete** เด็ดขาด
- ทุก query ต้องมี `where: { deletedAt: null }` เสมอ
- Soft delete = `update({ data: { deletedAt: new Date() } })`

## Money Fields
- ใช้ `Decimal` เท่านั้น: `@db.Decimal(12, 2)`
- **ห้ามใช้ Float หรือ Int** สำหรับจำนวนเงิน
- ตัวอย่าง: `price Decimal @db.Decimal(12, 2)`

## Relations
- ตั้งชื่อ `@relation("RelationName")` เมื่อ model มีหลาย relation ไปที่ model เดียวกัน
- ใส่ `@relation(onDelete: Cascade)` เฉพาะเมื่อ child ไม่มีความหมายหากไม่มี parent

## Indexes
- เพิ่ม `@@index([fieldName])` สำหรับ fields ที่ถูก query บ่อย
- Composite index สำหรับ queries ที่ filter หลาย fields พร้อมกัน

## Enums
- ประกาศที่ส่วนบนของ `schema.prisma`
- ชื่อ enum type ใช้ PascalCase เช่น `enum PaymentStatus { ... }`
- ค่า enum values ใช้ SCREAMING_SNAKE_CASE เช่น `PENDING`, `COMPLETED`

## Migrations
- ชื่อ descriptive: `add_warranty_model`, `add_phone_field_to_customer`
- Production ใช้ `prisma migrate deploy` เท่านั้น — ห้ามใช้ `migrate dev`
- Field ใหม่ที่ required บน table ที่มีข้อมูลแล้ว → ต้องมี `@default()` หรือใช้ 2-step migration (เพิ่มแบบ optional → backfill → เปลี่ยนเป็น required)
- Rename column → ใช้ `@map("old_name")` แทนการ drop แล้วสร้างใหม่
