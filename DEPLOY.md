# Deploy to DigitalOcean App Platform

## Prerequisites

- DigitalOcean account
- GitHub repo connected to DigitalOcean
- `doctl` CLI installed (optional)

## Option A: Deploy via Console (UI)

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click **Create App**
3. Select your GitHub repository and branch
4. DigitalOcean will detect `.do/app.yaml` automatically
5. **Update secrets** before deploying:
   - `JWT_SECRET` - generate with `openssl rand -hex 32`
   - `JWT_REFRESH_SECRET` - generate with `openssl rand -hex 32`
   - `ENCRYPTION_KEY` - generate with `openssl rand -hex 16` (32 chars)
6. Click **Create Resources**

## Option B: Deploy via CLI (`doctl`)

```bash
# Install doctl
# https://docs.digitalocean.com/reference/doctl/how-to/install/

# Login
doctl auth init

# Create app from spec
doctl apps create --spec .do/app.yaml

# Update app
doctl apps update <app-id> --spec .do/app.yaml
```

## After First Deploy

Run database migration manually (first time only):

```bash
# Via App Console > API service > Console tab:
npx prisma migrate deploy --schema=./apps/api/prisma/schema.prisma
node apps/api/dist/prisma/seed.js
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Auto (managed DB) |
| `JWT_SECRET` | JWT signing key | Yes (secret) |
| `JWT_REFRESH_SECRET` | Refresh token signing key | Yes (secret) |
| `ENCRYPTION_KEY` | 32-char encryption key | Yes (secret) |
| `FRONTEND_URL` | Frontend URL for CORS | Auto (${APP_URL}) |

## Estimated Cost

| Component | Size | Cost/month |
|-----------|------|------------|
| API | basic-xxs (512MB) | ~$5 |
| Web | Static site | Free |
| Database | db-s-dev | ~$7 |
| **Total** | | **~$12/month** |

## Deploy to Droplet (Alternative)

If you prefer a VPS, use `docker-compose.prod.yml`:

```bash
# On your Droplet:
git clone <repo> /opt/bestchoice
cd /opt/bestchoice

# Create .env
cat > .env << 'EOF'
DB_USER=installment
DB_PASSWORD=your_strong_password
DB_NAME=installment_db
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
FRONTEND_URL=https://yourdomain.com
EOF

# Start everything
docker compose -f docker-compose.prod.yml up -d
```
