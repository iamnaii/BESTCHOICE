#!/bin/bash
# ==============================================
# BESTCHOICE - DigitalOcean Auto Deploy Script
# ==============================================
# Usage: ssh root@YOUR_IP แล้วรัน:
#   curl -sL https://raw.githubusercontent.com/iamnaii/BESTCHOICE/claude/complete-phases-3-4-M3zIj/scripts/deploy-digitalocean.sh | bash
#   หรือ copy script นี้ไปวางแล้วรัน
# ==============================================

set -euo pipefail

SERVER_IP="${SERVER_IP:-129.212.210.222}"
BRANCH="claude/complete-phases-3-4-M3zIj"
INSTALL_DIR="/opt/installment-system"

echo "============================================"
echo "  BESTCHOICE - Auto Deploy to DigitalOcean"
echo "============================================"
echo ""

# --- Step 1: Install dependencies ---
echo "[1/7] Installing Docker, Git, Node.js..."
apt update -y && apt upgrade -y
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "  -> Done!"

# --- Step 2: Clone project ---
echo "[2/7] Cloning BESTCHOICE project..."
rm -rf "$INSTALL_DIR"
git clone https://github.com/iamnaii/BESTCHOICE.git "$INSTALL_DIR"
cd "$INSTALL_DIR"
git checkout "$BRANCH"
echo "  -> Done!"

# --- Step 3: Create .env ---
echo "[3/7] Creating .env file..."
JWT_SECRET=$(openssl rand -base64 48)
DB_PASSWORD=$(openssl rand -base64 24)

cat > .env << EOF
DB_USER=installment
DB_PASSWORD=$DB_PASSWORD
DB_NAME=installment_db
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://$SERVER_IP
HTTP_PORT=80
HTTPS_PORT=443
EOF
echo "  -> Done!"

# --- Step 4: Build frontend ---
echo "[4/7] Building frontend (this may take a few minutes)..."
npm install
cd apps/web && npm run build && cd ../..
echo "  -> Done!"

# --- Step 5: Start Docker containers ---
echo "[5/7] Starting Docker containers..."
docker compose -f docker-compose.prod.yml up -d --build

echo "  Waiting for services to be healthy..."
sleep 30

docker compose -f docker-compose.prod.yml ps
echo "  -> Done!"

# --- Step 6: Run migrations + seed ---
echo "[6/7] Running database migrations and seed..."
docker compose -f docker-compose.prod.yml exec -T api \
  npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma

docker compose -f docker-compose.prod.yml exec -T api \
  npx prisma db seed --schema=apps/api/prisma/schema.prisma
echo "  -> Done!"

# --- Step 7: Setup firewall + backup ---
echo "[7/7] Setting up firewall and auto-backup..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Setup auto backup
chmod +x "$INSTALL_DIR/scripts/backup.sh"
mkdir -p /opt/backups/installment
(crontab -l 2>/dev/null; echo "0 2 * * * $INSTALL_DIR/scripts/backup.sh >> /var/log/installment-backup.log 2>&1") | crontab -
echo "  -> Done!"

echo ""
echo "============================================"
echo "  DEPLOY COMPLETE!"
echo "============================================"
echo ""
echo "  Open: http://$SERVER_IP"
echo ""
echo "  Login:"
echo "    Email:    admin@bestchoice.com"
echo "    Password: admin1234"
echo ""
echo "  ** IMPORTANT: Change admin password after login! **"
echo ""
echo "============================================"
