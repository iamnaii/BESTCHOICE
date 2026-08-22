# Coding Standards

## Naming Conventions
- **camelCase** — variables, functions, methods
- **PascalCase** — components, classes, types, enums, interfaces
- **PascalCase** — React component files (เช่น `CustomersPage.tsx`, `AuthContext.tsx`)
- **kebab-case** — module directories, non-component files
- **SCREAMING_SNAKE_CASE** — Prisma enums, constants

## Formatting (Prettier)
```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

## Imports
- **Web app**: ใช้ `@/` alias เช่น `import { api } from '@/lib/api'`
- **API modules**: ใช้ relative imports ภายใน module เดียวกัน
- **Shared**: import จาก `packages/shared/`

## ค้นหาก่อนสร้าง
- ค้นหา existing components, hooks, utilities ใน codebase ก่อนสร้างใหม่เสมอ
- ตรวจว่ามี module/page ที่ทำงานคล้ายกันอยู่แล้วหรือไม่
- Reuse code ที่มีอยู่แทนการ duplicate

## Language
- **UI text**: ภาษาไทย (user-facing)
- **Validation messages**: ภาษาไทย
- **Code comments**: ภาษาอังกฤษหรือไทยก็ได้
- **Variable/function names**: ภาษาอังกฤษเสมอ

### ข้อความ error ต้องชี้ทางที่ "ทำได้จริงวันนี้" (บทเรียน Phase 5, 2026-08-22)

ข้อความที่บอกทางออกซึ่ง**ไม่มีอยู่จริง** แย่กว่าข้อความห้วน ๆ ที่ไม่บอกอะไรเลย —
มันส่งผู้ใช้ไปชนกำแพงแล้วกลับมาไม่มีทางไปต่อ. กติกา: **เขียนข้อความหลังเปิดโค้ดของ
หน้าจอปลายทางและ `@Roles` ของ endpoint นั้นแล้วเท่านั้น** ห้ามเขียนจาก docblock,
ชื่อฟังก์ชัน, หรือความจำ.

เช็ค 3 ข้อก่อนเขียนประโยคที่ขึ้นต้นว่า "ให้ไป…":
1. **เมนู/ปุ่มนั้นมีจริงไหม** — grep หน้าจอ ไม่ใช่ชื่อ service (เช่น "ยกเลิกการขาย"
   ไม่มีอยู่จริง: โมดูล `sales` มี `findAll/findOne/create` เท่านั้น)
2. **ทำแล้วสำเร็จไหม** — ฟอร์มปลายทางอาจปฏิเสธ input ที่จำเป็น (เช่น สั่งให้ "ล้างราคา"
   ทั้งที่ฟอร์มปล่อยช่องว่าง = ไม่แตะคอลัมน์, และ `removePrice` ปฏิเสธเมื่อเหลือแถวเดียว)
3. **role ที่เจอ error นี้เข้าถึงได้ไหม** — `@Roles` ของปลายทาง (เช่น `SALES` ตั้งราคาเองไม่ได้
   ⇒ ห้ามบอกให้ไปตั้งราคาเอง)

หลักฐาน: finding "ชี้ทางที่ไม่มีจริง" ซ้ำ **3 รอบ** ใน Phase 5 Tasks 2-3 (fix round 3
Important 2 → round 4 Important 2 ข → round 4 Minor 4) ทั้งหมดเกิดจากการเขียนข้อความ
จาก docblock/ความจำแทนการเปิดโค้ดปลายทาง.

## IDs & Timestamps
- IDs: UUID (`@default(uuid())`) ทุก model
- Timestamps: ทุก model ต้องมี `createdAt`, `updatedAt`, `deletedAt`

## Git
- Commit messages: descriptive, ระบุ issue number เมื่อมี
- ห้าม commit `.env`, credentials, หรือ secrets
