---
name: run-e2e
description: รัน Playwright E2E Tests โดยตรงผ่าน Claude Code
user_invocable: true
---

# Skill: Run E2E Tests

รัน Playwright E2E tests โดยตรงผ่าน Claude Code โดยไม่ต้องเปิด terminal แยก

## Prerequisites (ต้องมีก่อนรัน)

ตรวจว่า services เหล่านี้รันอยู่:
1. **PostgreSQL** — `docker compose up -d db` (ถ้ายังไม่ได้รัน)
2. **NestJS API** (port 3000) — `cd apps/api && npm run dev` (ถ้ายังไม่ได้รัน)
3. **Playwright browsers** — SessionStart hook จัดการให้อัตโนมัติ

Vite dev server (port 5173) จะถูก start อัตโนมัติโดย Playwright

## ขั้นตอน

### 1. ถามว่าต้องการรันอะไร

| ตัวเลือก | คำสั่ง |
|---|---|
| รันทั้งหมด (chromium) | `cd apps/web && npx playwright test --project=chromium` |
| รันไฟล์เดียว | `cd apps/web && npx playwright test e2e/<file>.spec.ts --project=chromium` |
| รัน pattern | `cd apps/web && npx playwright test --grep "login" --project=chromium` |
| Full suite (lint+types+E2E) | `./tools/run-tests.sh` |
| E2E พร้อมดู browser | `cd apps/web && npx playwright test --headed --project=chromium` |

### 2. ตรวจ Services

```bash
# ตรวจ API (port 3000)
curl -s http://localhost:3000/health || echo "API ไม่ได้รัน — รัน: cd apps/api && npm run dev"

# ตรวจ DB connection ผ่าน API health
curl -s http://localhost:3000/api/health | grep -q "ok" && echo "API ready" || echo "API not ready"
```

### 3. รัน Tests

รันตามที่ user ขอ แล้วรายงานผล:
- จำนวน tests ที่ pass/fail
- ถ้า fail → แสดง error message + แนะนำการ debug
- รายงาน path ของ HTML report: `apps/web/playwright-report/index.html`

### 4. ถ้ามี Failures

- อ่าน error message จาก output
- ดู screenshot ที่ fail: `apps/web/test-results/`
- แนะนำ fix หรือเปิด `/fix-bug` skill ถ้าเจอ bug จริง

## ตัวอย่างคำสั่งที่ user พูดได้

- "รัน E2E ทั้งหมด" → รัน `npx playwright test --project=chromium`
- "รัน E2E เทส login" → รัน `npx playwright test e2e/login.spec.ts --project=chromium`
- "รัน human flow tests" → รัน `npx playwright test e2e/human-flows/ --project=chromium`
- "รัน agent tests" → รัน `npx playwright test e2e/agents/ --project=chromium`
- `/run-e2e login` → รัน login spec โดยตรง

## Advanced Options

| ตัวเลือก | คำสั่ง | ใช้เมื่อ |
|---|---|---|
| Debug mode | `npx playwright test --debug` | ต้องการ step-through debugger |
| UI mode | `npx playwright test --ui` | ต้องการ interactive test runner |
| Trace on | `npx playwright test --trace on` | ต้องการ trace ดู timeline |

## Common Issues

| ปัญหา | วิธีแก้ |
|---|---|
| API ไม่ได้รัน (port 3000) | `cd apps/api && npm run dev` |
| DB connection failed | `docker compose up -d db` |
| Test flaky (ผ่านบ้างไม่ผ่านบ้าง) | รัน 3 ครั้ง — ถ้า flaky จริงให้ investigate race condition |
| Timeout errors | เพิ่ม timeout หรือตรวจ network/API speed |
