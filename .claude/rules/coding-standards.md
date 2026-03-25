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

## IDs & Timestamps
- IDs: UUID (`@default(uuid())`) ทุก model
- Timestamps: ทุก model ต้องมี `createdAt`, `updatedAt`, `deletedAt`

## Git
- Commit messages: descriptive, ระบุ issue number เมื่อมี
- ห้าม commit `.env`, credentials, หรือ secrets
