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

### Staff (admin panel)
- `/login` - Login page
- `/forgot-password` - Forgot password
- `/reset-password` - Reset password
- `/` - Dashboard (protected)
- `/pos` - Point of Sale
- `/customers` - Customer management
- `/customers/:id` - Customer detail
- `/contracts` - Installment contracts
- `/contracts/create` - Create contract
- `/contracts/:id` - Contract detail
- `/contracts/:id/sign` - Contract signing
- `/contract-templates` - Contract template editor
- `/verify/:id` - Contract verification (public)
- `/payments` - Payment recording
- `/payments/import-csv` - CSV payment import
- `/stock` - Inventory management
- `/stock/transfers` - Stock transfers
- `/stock/alerts` - Reorder point alerts
- `/stock/count` - Stock count
- `/stock/adjustments` - Stock adjustments
- `/reports` - Reports
- `/suppliers` - Supplier management
- `/suppliers/:id` - Supplier detail
- `/purchase-orders` - Purchase orders
- `/overdue` - Overdue tracking
- `/exchange` - Device exchange
- `/repossessions` - Repossession management
- `/receipts` - Receipt management
- `/slip-review` - Payment slip review
- `/sales` - Sales history
- `/stickers` - Sticker printing
- `/branches` - Branch management
- `/audit-logs` - Audit log viewer
- `/financial-audit` - Financial audit (OWNER/ACCOUNTANT)
- `/document-dashboard` - Document dashboard
- `/credit-checks` - Credit check management
- `/notifications` - Notifications
- `/migration` - Data migration tool
- `/pdpa` - PDPA management
- `/settings` - System settings
- `/settings/interest-config` - Interest rate configuration (OWNER)
- `/settings/line-oa` - LINE OA settings (OWNER)
- `/settings/sms` - SMS settings (OWNER)
- `/settings/pricing-templates` - Pricing template settings (OWNER)
- `/users` - User management (OWNER)
- `/system-status` - System status (OWNER)
- `/landing` - Landing page (public)

### Customer / LINE LIFF (public access)
- `/liff/contract` - LIFF contract view
- `/liff/early-payoff` - LIFF early payoff
- `/liff/history` - LIFF payment history
- `/liff/profile` - LIFF customer profile
- `/liff/register` - LIFF customer registration
- `/pay/:token` - Public payment page (PromptPay QR)
- `/customer-access/:token` - Customer self-service portal

## User Roles
- OWNER - Full access
- BRANCH_MANAGER - Branch-level access
- ACCOUNTANT - Financial access
- SALES - Sales operations

## Architecture Notes
- JWT auth with refresh token rotation (httpOnly cookie)
- LINE LIFF integration for customer mobile access
- API proxy: Vite dev server proxies /api to localhost:3000
- File storage: S3-compatible (MinIO in dev) via `@aws-sdk/client-s3`; requires `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`
- State management: Zustand + React Query (TanStack)
- UI primitives: Radix UI, Tiptap (rich text), dnd-kit (drag-and-drop)
- **Unrouted page files** (exist but not wired into router): `InventoryWorkflowPage.tsx`, `InspectionPage.tsx`, `InspectionDetailPage.tsx` (sub-pages of unrouted parent). `BranchReceivingPage.tsx` is superseded — `/stock/branch-receiving` redirects to `/stock/transfers?view=incoming`.
- Access token stored **in-memory** (JS variable, NOT localStorage), refresh token in httpOnly cookie
