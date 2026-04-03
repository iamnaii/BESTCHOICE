# BESTCHOICE System Architecture

## Overview

```
┌──────────────────────────────────────────────────────┐
│                    Clients                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Web App  │  │ LINE     │  │ Customer Portal  │   │
│  │ (React)  │  │ LIFF     │  │ /customer-access │   │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
└───────┼──────────────┼────────────────┼──────────────┘
        │              │                │
        ▼              ▼                ▼
┌──────────────────────────────────────────────────────┐
│                 API Gateway (NestJS)                  │
│  ┌────────┐  ┌──────────┐  ┌──────────┐             │
│  │ JWT    │  │ Throttle │  │ CSRF     │             │
│  │ Guard  │  │ 200/s    │  │ Guard    │             │
│  └────────┘  └──────────┘  └──────────┘             │
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │           44 REST Controllers                 │   │
│  │  Auth │ Contracts │ Payments │ Products │ ... │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ WebSocket│  │ BullMQ   │  │ Cron Scheduler   │   │
│  │ Gateway  │  │ Queue    │  │ (8 jobs)         │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ PostgreSQL   │ │ Redis        │ │ S3 / MinIO   │
│ 54 tables    │ │ Cache+Queue  │ │ File Storage │
│ 286 indexes  │ │ BullMQ jobs  │ │ Photos/Docs  │
└──────────────┘ └──────────────┘ └──────────────┘

        ┌──────────────────────────────────┐
        │       External Services          │
        │  ┌─────────┐  ┌──────────────┐   │
        │  │ LINE OA │  │ ThaiBulkSMS  │   │
        │  │ Webhook  │  │ API V2       │   │
        │  └─────────┘  └──────────────┘   │
        │  ┌─────────┐  ┌──────────────┐   │
        │  │ Pay     │  │ Anthropic AI │   │
        │  │Solutions│  │ OCR + Credit │   │
        │  └─────────┘  └──────────────┘   │
        │  ┌─────────┐  ┌──────────────┐   │
        │  │ Resend  │  │ Sentry       │   │
        │  │ (SMTP)  │  │ Error Monitor│   │
        │  └─────────┘  └──────────────┘   │
        └──────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + TypeScript + Vite + Tailwind | 18.3 / 6.0 |
| Backend | NestJS + Prisma | 10.4 / 6.19 |
| Database | PostgreSQL | 16 |
| Cache/Queue | Redis + BullMQ | 7 / 5.x |
| File Storage | S3 (MinIO in dev) | — |
| Auth | JWT (in-memory) + httpOnly refresh cookie | — |
| Deploy | GCP Cloud Run + Firebase Hosting | — |
| CI/CD | GitHub Actions | — |
| Monitoring | Sentry | — |

## Database ER Diagram (Core Models)

```
                    ┌──────────────┐
                    │   Branch     │
                    │──────────────│
                    │ id           │
                    │ name         │
                    │ isMainWarehouse│
                    └──────┬───────┘
                           │ 1:N
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │  User    │ │ Product  │ │ Contract │
       │──────────│ │──────────│ │──────────│
       │ email    │ │ name     │ │ number   │
       │ role     │ │ imei     │ │ status   │──┐
       │ 2FA      │ │ status   │ │ financed │  │
       │ branchId │ │ warranty │ │ monthly  │  │
       └──────────┘ │ branchId │ │ customer │  │
                    │ costPrice│ │ product  │  │
                    └──────────┘ │ branch   │  │
                                 └──────────┘  │
                                      │        │
                           ┌──────────┘        │
                           ▼ 1:N               │
                    ┌──────────┐               │
                    │ Payment  │               │
                    │──────────│               │
                    │ installNo│               │
                    │ amountDue│               │
                    │ amountPaid│              │
                    │ lateFee  │               │
                    │ status   │               │
                    │ dueDate  │               │
                    └──────────┘               │
                           │ 1:1               │
                           ▼                   │
                    ┌──────────┐               │
                    │ Receipt  │               │
                    │──────────│               │
                    │ number   │◄──────────────┘
                    │ amount   │
                    │ paidDate │
                    │ fileHash │
                    └──────────┘

       ┌──────────┐        ┌──────────────┐
       │ Customer │ 1:N    │ CreditCheck  │
       │──────────│───────▶│──────────────│
       │ name     │        │ score        │
       │ nationalId│       │ result       │
       │ phone    │        │ aiAnalysis   │
       └──────────┘        └──────────────┘

       ┌──────────┐        ┌──────────────┐
       │ Supplier │ 1:N    │PurchaseOrder │
       │──────────│───────▶│──────────────│
       │ name     │        │ poNumber     │
       │ contact  │        │ status       │
       │ taxId    │        │ totalAmount  │
       └──────────┘        └──────────────┘
```

## 54 Database Tables

### Core Business (8)
Branch, Customer, Contract, Payment, Sale, Receipt, CreditCheck, FinanceReceivable

### Products & Stock (14)
Product, ProductPhoto, ProductPrice, PricingTemplate, StockTransfer, GoodsReceiving, GoodsReceivingItem, StockAdjustment, StockCount, StockCountItem, BranchReceiving, BranchReceivingItem, ReorderPoint, StockAlert

### Procurement (4)
Supplier, SupplierPaymentMethod, PurchaseOrder, POItem

### Quality & Inspection (4)
InspectionTemplate, InspectionTemplateItem, Inspection, InspectionResult

### Documents & Templates (5)
ContractTemplate, ContractDocument, EDocument, Signature, StickerTemplate

### Auth & Security (5)
User (with 2FA), RefreshToken, PasswordResetToken, InviteToken, KycVerification

### PDPA & Compliance (2)
PDPAConsent, DSARRequest

### Communication (4)
NotificationLog, CallLog, PaymentLink, PaymentEvidence

### Operations (4)
Repossession, Expense, AuditLog, DocumentAuditLog

### System (4)
SystemConfig, CompanyInfo, InterestConfig, CustomerAccessToken

## Cron Jobs Schedule

| Time (ICT) | Job | Description |
|------------|-----|-------------|
| 00:00 | Late Fee Calculation | Bulk SQL update overdue payments |
| 00:30 | Contract Status Update | OVERDUE → DEFAULT escalation |
| 01:00 | Dunning Stage Escalation | 4-stage auto-escalation |
| 02:00 | Database Backup | pg_dump → gzip (30-day retention) |
| 02:30 | Warranty Expiry Check | Mark expired warranties |
| 06:00 | Payment Reminders (LINE) | Send LINE flex messages |
| 23:55 | Daily Report Generation | Revenue + payments summary |
| Monday 00:05 | Weekly Report | Aggregate weekly summary |
| Every 5 min | Notification Retry Queue | Retry failed LINE/SMS |

## Security Layers

1. **CORS** — Restricted to FRONTEND_URL
2. **CSRF Guard** — X-Requested-With header validation
3. **JWT Auth** — Access token (15m) + httpOnly refresh cookie (7d)
4. **2FA (TOTP)** — Optional for all users, encrypted secrets
5. **Rate Limiting** — 200/s global, per-endpoint throttle
6. **RBAC** — 4 roles (OWNER > BRANCH_MANAGER > ACCOUNTANT > SALES)
7. **Branch Isolation** — Entity-level branchId checks
8. **Input Sanitization** — XSS/SQL injection pattern blocking
9. **Security Headers** — HSTS, CSP, X-Frame-Options, etc.
10. **Audit Trail** — Financial operations logged with user context

## User Roles

| Role | Access |
|------|--------|
| OWNER | Everything |
| BRANCH_MANAGER | Branch operations, finance, reports (not system settings) |
| ACCOUNTANT | Finance, reports, receipts, stock (read-only) |
| SALES | POS, contracts, customers, stock (read-only) |
