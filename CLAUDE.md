# BESTCHOICE - ระบบผ่อนชำระ (Installment Management System)

## Project Overview
BESTCHOICE is a full-stack installment payment management system for mobile/phone shops in Thailand.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind CSS (apps/web)
- **Backend**: NestJS + Prisma + PostgreSQL (apps/api)
- **Monorepo**: Turborepo with npm workspaces

## Development
```bash
# Install dependencies
npm install

# Start dev servers (API + Web)
npm run dev

# Web only (localhost:5173)
cd apps/web && npm run dev

# API only (localhost:3000)
cd apps/api && npm run dev
```

## Test Accounts (Dev Mode)
- **Admin**: admin@bestchoice.com / admin1234

## E2E Testing with Playwright
```bash
# Run all E2E tests
cd apps/web && npx playwright test

# Run with browser visible
cd apps/web && npx playwright test --headed

# Run specific test file
cd apps/web && npx playwright test e2e/login.spec.ts

# Open Playwright UI (interactive mode)
cd apps/web && npx playwright test --ui

# Generate test report
cd apps/web && npx playwright show-report
```

## Key Routes
- `/login` - Login page
- `/` - Dashboard (protected)
- `/pos` - Point of Sale
- `/customers` - Customer management
- `/contracts` - Installment contracts
- `/payments` - Payment recording
- `/stock` - Inventory management
- `/reports` - Reports

## User Roles
- OWNER - Full access
- BRANCH_MANAGER - Branch-level access
- ACCOUNTANT - Financial access
- SALES - Sales operations

## Architecture Notes
- JWT auth with refresh token rotation (httpOnly cookie)
- LINE LIFF integration for customer mobile access
- API proxy: Vite dev server proxies /api to localhost:3000
- Access token stored in localStorage, refresh token in httpOnly cookie
