# Workflow: Deployment

## Objective
Deploy BESTCHOICE ขึ้น production อย่างปลอดภัย

## Reference
- CI/CD: `.github/workflows/deploy.yml`
- Deploy script: `scripts/deploy-digitalocean.sh`
- Docker: `Dockerfile`, `docker-compose.yml`

## Automated Pipeline (GitHub Actions)
Push ไปยัง `main` branch จะ trigger pipeline อัตโนมัติ:

### Stage 1: lint-and-test
1. Setup Node 20
2. Install dependencies
3. `npx prisma generate`
4. Run migrations (test DB)
5. Lint API + Web
6. Test API
7. Build API + Web
8. Seed database
9. Run Playwright E2E tests (chromium)

### Stage 2: build-and-push
1. Docker build
2. Push to container registry (tag: `latest` + `sha`)

### Stage 3: deploy
1. SSH to production server
2. `docker compose pull`
3. `npx prisma migrate deploy`
4. Restart services

## Manual Checks ก่อน Deploy
```bash
# 1. TypeScript check
./tools/check-types.sh all

# 2. Run tests
./tools/run-tests.sh

# 3. ตรวจ pending migrations
cd apps/api && npx prisma migrate status
```

## Edge Cases
- **Migration failure**: ตรวจ SQL ก่อน deploy, backup database ก่อน
- **Rollback**: revert commit + redeploy, อย่าลืม rollback migration ด้วย
- **Environment variables**: ตรวจว่า production env มี variables ใหม่ครบ (ดู `.env.example`)
- **Breaking API changes**: coordinate กับ frontend build

## Output
- Application deployed + running
- Migrations applied
- Health check passed
