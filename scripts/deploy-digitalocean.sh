#!/bin/bash
# ==============================================
# BESTCHOICE - DigitalOcean Auto Deploy Script
# ==============================================
# Usage: ssh root@YOUR_IP แล้วรัน:
#   curl -sL https://raw.githubusercontent.com/iamnaii/BESTCHOICE/main/scripts/deploy-digitalocean.sh | bash
#   หรือ copy script นี้ไปวางแล้วรัน
# ==============================================

set -euo pipefail

BRANCH="${BRANCH:-main}"
INSTALL_DIR="/opt/bestchoice"
SERVER_IP=$(curl -s http://checkip.amazonaws.com || hostname -I | awk '{print $1}')

echo "============================================"
echo "  BESTCHOICE - Auto Deploy to DigitalOcean"
echo "============================================"
echo "  Server IP: $SERVER_IP"
echo "  Branch:    $BRANCH"
echo ""

# --- Step 1: Install dependencies ---
echo "[1/7] Installing Docker, Git..."
apt update -y
apt install -y ca-certificates curl gnupg

if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

apt install -y docker-compose-plugin git
echo "  -> Done!"

# --- Step 2: Clone project ---
echo "[2/7] Cloning BESTCHOICE project..."
if [ -d "$INSTALL_DIR" ]; then
  echo "  -> Directory exists, pulling latest changes..."
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  git clone https://github.com/iamnaii/BESTCHOICE.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  git checkout "$BRANCH"
fi
echo "  -> Done!"

# --- Step 3: Create .env ---
echo "[3/7] Creating .env file..."
if [ -f .env ]; then
  echo "  -> .env already exists, keeping existing config"
else
  JWT_SECRET=$(openssl rand -hex 32)
  JWT_REFRESH_SECRET=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 16)
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)

  cat > .env << EOF
# Database
DB_USER=installment
DB_PASSWORD=$DB_PASSWORD
DB_NAME=installment_db

# JWT Authentication
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Encryption (for national_id)
ENCRYPTION_KEY=$ENCRYPTION_KEY

# App
FRONTEND_URL=http://$SERVER_IP
NODE_ENV=production

# Docker Ports
HTTP_PORT=80
HTTPS_PORT=443
EOF
  echo "  -> .env created with random secrets"
fi
echo "  -> Done!"

# --- Step 4: Create SSL directory ---
echo "[4/7] Preparing directories..."
mkdir -p "$INSTALL_DIR/nginx/ssl"
mkdir -p /opt/backups/installment
echo "  -> Done!"

# --- Step 5: Start Docker containers ---
echo "[5/7] Building and starting Docker containers (this may take 5-10 minutes)..."
docker compose -f docker-compose.prod.yml up -d --build

echo "  Waiting for services to be healthy..."
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml ps | grep -q "healthy"; then
    break
  fi
  sleep 5
  echo "  Still waiting... ($((i*5))s)"
done

docker compose -f docker-compose.prod.yml ps
echo "  -> Done!"

# --- Step 6: Verify services ---
echo "[6/7] Verifying services..."
sleep 10

if curl -sf http://localhost/api/health > /dev/null 2>&1; then
  echo "  -> API health check: OK"
else
  echo "  -> API still starting, checking containers..."
  docker compose -f docker-compose.prod.yml ps
  echo "  -> Wait a moment and try: curl http://localhost/api/health"
fi
echo "  -> Done!"

# --- Step 7: Setup firewall + backup ---
echo "[7/7] Setting up firewall and auto-backup..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Setup auto backup (daily at 2 AM)
chmod +x "$INSTALL_DIR/scripts/backup.sh" 2>/dev/null || true
if ! crontab -l 2>/dev/null | grep -q "backup.sh"; then
  (crontab -l 2>/dev/null; echo "0 2 * * * $INSTALL_DIR/scripts/backup.sh >> /var/log/bestchoice-backup.log 2>&1") | crontab -
  echo "  -> Auto-backup scheduled (daily at 2:00 AM)"
fi
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
echo "  Useful commands:"
echo "    cd $INSTALL_DIR"
echo "    docker compose -f docker-compose.prod.yml logs -f     # ดู logs"
echo "    docker compose -f docker-compose.prod.yml restart      # restart"
echo "    docker compose -f docker-compose.prod.yml down          # stop"
echo "    ./scripts/backup.sh                                     # backup DB"
echo ""
echo "============================================"
