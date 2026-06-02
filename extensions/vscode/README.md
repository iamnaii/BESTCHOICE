# BESTCHOICE Helper — VSCode Extension

Shortcuts รวมศูนย์สำหรับงานบน BESTCHOICE monorepo — เรียก WAT tools, เปิด workflows/rules, และ snippets ตาม pattern โปรเจค

## Commands (Cmd/Ctrl+Shift+P → `BESTCHOICE:`)

| Command | สิ่งที่ทำ |
|---|---|
| Check Types (all/API/Web) | `./tools/check-types.sh` |
| Generate API Module | input ชื่อ → `./tools/generate-module.sh <name>` |
| Run Tests | `./tools/run-tests.sh` (lint + types + e2e) |
| Run E2E Tests | `cd apps/web && npx playwright test` |
| Reset Dev Database | `./tools/db-reset.sh` (มี confirm) |
| Start Dev Servers | `npm run dev` (turbo: API + Web) |
| Start API only | `cd apps/api && npm run dev` |
| Start Web only | `cd apps/web && npm run dev` |
| Pre-Deploy Check | check-types + run-tests |
| Open Workflow… | quick pick `workflows/*.md` |
| Open Rule… | quick pick `.claude/rules/*.md` |
| FB App Review Preflight | `./tools/fb-app-review-preflight.sh` |

## Snippets

| Prefix | ใช้ใน | สิ่งที่สร้าง |
|---|---|---|
| `bc-controller` | .ts | NestJS controller + JwtAuthGuard + RolesGuard |
| `bc-service` | .ts | NestJS service + PrismaService + soft delete |
| `bc-dto-create` | .ts | Create DTO + class-validator (Thai msgs) |
| `bc-dto-update` | .ts | Update DTO (`PartialType`) |
| `bc-module` | .ts | NestJS module declaration |
| `bc-page` | .tsx | React page + useQuery + QueryBoundary |
| `bc-query` | .tsx | useQuery hook |
| `bc-mutation` | .tsx | useMutation + toast + invalidate |
| `bc-form` | .tsx | react-hook-form + zod |
| `bc-model` | .prisma | Prisma model + UUID + timestamps + soft delete |
| `bc-money` | .prisma | `Decimal @db.Decimal(12, 2)` |
| `bc-enum` | .prisma | enum (SCREAMING_SNAKE_CASE) |

## ติดตั้ง / Deploy

```bash
# Dev: open this folder in VSCode → press F5 to launch Extension Development Host

# Build .vsix
npm install
npm run package
# → produces bestchoice-helper-0.1.0.vsix

# Install in VSCode
code --install-extension bestchoice-helper-0.1.0.vsix
# หรือ: npm run package:install
```

## Distribution

ไฟล์ `.vsix` ใช้แจกผ่าน:
- ดับเบิลคลิกใน Explorer → VSCode จะ install ให้
- `code --install-extension *.vsix` ใน terminal
- VSCode → Extensions panel → "..." → Install from VSIX

ไม่ publish ไป Marketplace (extension นี้ private สำหรับทีม BESTCHOICE)

## Activation

Extension จะ activate อัตโนมัติเมื่อ workspace มี `turbo.json` + `apps/api/package.json` (ป้องกัน activate ผิด project)
