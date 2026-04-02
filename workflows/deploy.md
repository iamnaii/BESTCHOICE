# Workflow: Deployment (GCP)

## Objective
Deploy BESTCHOICE ขึ้น production อย่างปลอดภัย

## Reference
- CI/CD: `.github/workflows/deploy-gcp.yml`
- Docker: `Dockerfile`, `docker-entrypoint.sh`
- Infrastructure: GCP Cloud Run + Firebase Hosting + Cloud SQL

## Automated Pipeline (GitHub Actions)
Push ไปยัง `main` branch จะ trigger pipeline อัตโนมัติ:

### Job 1: lint-and-test
1. Setup Node 20
2. Install dependencies
3. `npx prisma generate`
4. Run migrations (test DB)
5. Lint API + Web
6. Test API
7. Build API + Web
8. Seed database
9. Run Playwright E2E tests (chromium)

### Job 2: build-and-push-api
1. Authenticate to GCP
2. Docker build (multi-stage)
3. Push to Artifact Registry (tag: `latest` + `sha`)

### Job 3: migrate-db
1. Create/update Cloud Run Job for migrations
2. Execute `prisma migrate deploy` via Cloud Run Job

### Job 4: deploy-api
1. Deploy to Cloud Run (asia-southeast1)
2. Set secrets from GCP Secret Manager
3. Verify health check

### Job 5: deploy-web
1. Build frontend with production API URL
2. Deploy to Firebase Hosting

## Manual Checks before Deploy
```bash
# 1. TypeScript check
./tools/check-types.sh all

# 2. Run tests
./tools/run-tests.sh

# 3. Check pending migrations
cd apps/api && npx prisma migrate status
```

## Force Redeploy
```bash
git commit --allow-empty -m "chore: trigger redeploy"
git push origin main
```

## Edge Cases
- **Migration failure**: ตรวจ SQL ก่อน deploy, backup database ก่อน
- **Rollback**: revert commit + redeploy, อย่าลืม rollback migration ด้วย
- **Environment variables**: เพิ่ม secret ใหม่ใน GCP Secret Manager + update deploy-gcp.yml
- **Breaking API changes**: coordinate กับ frontend build

## Output
- API deployed on Cloud Run
- Frontend deployed on Firebase Hosting
- Migrations applied
- Health check passed
