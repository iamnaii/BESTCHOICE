# Deploy BESTCHOICE

## วิธีที่ 1: DigitalOcean App Platform (แนะนำ - ง่ายที่สุด)

ไม่ต้องจัดการ server เอง, ไม่ต้อง SSH, มี SSL อัตโนมัติ, deploy อัตโนมัติเมื่อ push code

**ค่าใช้จ่าย: ~$12/เดือน (~430 THB)**

### ขั้นตอนที่ 1: สร้างบัญชี DigitalOcean

1. เปิด https://cloud.digitalocean.com/registrations/new
2. สมัครบัญชี (ใช้ Email หรือ Google/GitHub ก็ได้)
3. ใส่บัตรเครดิต/เดบิต หรือ PayPal

### ขั้นตอนที่ 2: สร้าง App

1. เปิด https://cloud.digitalocean.com/apps
2. กด **Create App**
3. เลือก **GitHub** → เชื่อมต่อบัญชี GitHub
4. เลือก repository **iamnaii/BESTCHOICE** สาขา **main**
5. DigitalOcean จะตรวจจับ `.do/app.yaml` อัตโนมัติ
6. กด **Next**

### ขั้นตอนที่ 3: ตั้งค่า Secrets

ก่อนกด Deploy ให้แก้ค่า secret เหล่านี้:

| ตัวแปร | วิธีสร้าง | คำอธิบาย |
|--------|----------|---------|
| `JWT_SECRET` | `openssl rand -hex 32` | กุญแจสำหรับ login token |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` | กุญแจสำหรับ refresh token |
| `ENCRYPTION_KEY` | `openssl rand -hex 16` | กุญแจเข้ารหัสเลขบัตร (32 ตัวอักษร) |

> ถ้าไม่มี terminal ให้เปิด https://generate-random.org/api-key-generator เลือก 64 characters แล้ว copy มาใส่ได้เลย

### ขั้นตอนที่ 4: เลือก Region

- เลือก **Singapore (sgp)** เพื่อให้ใกล้ประเทศไทยที่สุด

### ขั้นตอนที่ 5: กด Create Resources

- กด **Create Resources** แล้วรอ 5-10 นาที
- DigitalOcean จะสร้าง API + Database + Frontend ให้อัตโนมัติ
- เมื่อเสร็จจะได้ URL เช่น `https://bestchoice-installment-xxxxx.ondigitalocean.app`

### ขั้นตอนที่ 6: ทดสอบ

1. เปิด URL ที่ได้จากขั้นตอนที่ 5
2. Login ด้วย:
   - Email: `admin@bestchoice.com`
   - Password: `admin1234`
3. **เปลี่ยนรหัสผ่าน admin ทันที!**

### การ Deploy ครั้งถัดไป

ไม่ต้องทำอะไร! แค่ `git push` ไปที่ main branch → DigitalOcean จะ deploy ให้อัตโนมัติ

### ค่าใช้จ่ายโดยประมาณ

| รายการ | ขนาด | ราคา/เดือน |
|--------|------|-----------|
| API | basic-xs (1 GB RAM) | ~$7 |
| Frontend | Static Site | ฟรี |
| Database | PostgreSQL dev | ~$7 |
| **รวม** | | **~$14/เดือน (~500 THB)** |

---

## วิธีที่ 2: DigitalOcean Droplet + Docker (ถูกกว่า แต่ต้อง SSH)

จัดการ server เอง, ใช้ Docker Compose, เหมาะกับคนที่มีพื้นฐาน Linux

**ค่าใช้จ่าย: ~$6-12/เดือน (~215-430 THB)**

### ขั้นตอนที่ 1: สร้าง Droplet

1. เปิด https://cloud.digitalocean.com/droplets
2. กด **Create Droplet**
3. ตั้งค่า:
   - **Region**: Singapore (SGP1)
   - **Image**: Ubuntu 24.04 LTS
   - **Size**: Regular → $12/เดือน (2 vCPU, 2 GB RAM, 60 GB SSD)
   - **Authentication**: เลือก Password (ง่ายกว่า) หรือ SSH Key (ปลอดภัยกว่า)
4. กด **Create Droplet**
5. จดจำ IP Address ที่ได้ (เช่น `167.71.xxx.xxx`)

### ขั้นตอนที่ 2: Deploy อัตโนมัติ (1 คำสั่ง)

เปิด terminal (Mac/Linux) หรือ PowerShell (Windows) แล้วรัน:

```bash
# SSH เข้า server
ssh root@YOUR_DROPLET_IP

# รัน deploy script อัตโนมัติ
curl -sL https://raw.githubusercontent.com/iamnaii/BESTCHOICE/main/scripts/deploy-digitalocean.sh | bash
```

สคริปต์จะทำทุกอย่างให้อัตโนมัติ:
- ติดตั้ง Docker + Git
- Clone โปรเจค
- สร้าง .env พร้อม random secrets
- Build + Start ทุก service
- ตั้งค่า Firewall
- ตั้ง Auto-backup ทุกวันตี 2

### ขั้นตอนที่ 3: ทดสอบ

1. เปิด `http://YOUR_DROPLET_IP` ในเบราว์เซอร์
2. Login ด้วย:
   - Email: `admin@bestchoice.com`
   - Password: `admin1234`
3. **เปลี่ยนรหัสผ่าน admin ทันที!**

### ขั้นตอนที่ 4: ตั้งค่า Domain (ถ้ามี)

```bash
# ถ้ามี domain name ให้ชี้ DNS A record มาที่ IP ของ Droplet
# แล้วตั้ง SSL ด้วย:
ssh root@YOUR_DROPLET_IP
apt install -y certbot
certbot certonly --standalone -d yourdomain.com

# Copy certificates
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /opt/bestchoice/nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /opt/bestchoice/nginx/ssl/

# Restart
cd /opt/bestchoice
docker compose -f docker-compose.prod.yml restart nginx
```

---

## การจัดการหลัง Deploy

### ดู Logs

```bash
# App Platform: ดูผ่าน DigitalOcean Console > Apps > api > Runtime Logs

# Droplet:
ssh root@YOUR_IP
cd /opt/bestchoice
docker compose -f docker-compose.prod.yml logs -f
docker compose -f docker-compose.prod.yml logs -f api    # เฉพาะ API
docker compose -f docker-compose.prod.yml logs -f db     # เฉพาะ Database
```

### อัปเดตระบบ (Droplet)

```bash
ssh root@YOUR_IP
cd /opt/bestchoice
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

### Backup Database (Droplet)

```bash
# Manual backup
/opt/bestchoice/scripts/backup.sh

# Backup ไฟล์อยู่ที่: /opt/backups/installment/
ls -la /opt/backups/installment/
```

### Restore Database (Droplet)

```bash
# Restore จาก backup
gunzip -c /opt/backups/installment/installment_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T db \
    psql -U installment installment_db
```

---

## เปรียบเทียบสองวิธี

| | App Platform | Droplet + Docker |
|---|---|---|
| **ความง่าย** | ง่ายมาก (กดๆ ในเว็บ) | ต้องใช้ terminal |
| **ราคา** | ~$14/เดือน (~500 THB) | ~$12/เดือน (~430 THB) |
| **SSL** | อัตโนมัติ | ต้องตั้งเอง (Certbot) |
| **Auto Deploy** | git push แล้วจบ | ต้อง SSH เข้าไป pull |
| **Scaling** | กดเพิ่มใน UI | ต้อง upgrade Droplet |
| **Backup** | อัตโนมัติ (Managed DB) | ตั้ง cron เอง |
| **แนะนำสำหรับ** | มือใหม่ / ไม่อยากจัดการ server | คนมีพื้นฐาน / อยากประหยัด |

---

## เครื่องอ่านบัตรประชาชน (Card Reader)

ตัวอ่านบัตร **ติดตั้งบนเครื่อง Windows ของร้าน** (ไม่ได้อยู่บน server) เพราะต้องต่อ USB โดยตรง

### ติดตั้ง (สำหรับคนไม่เก่ง IT — ง่ายมาก)

1. เปิดหน้า **GitHub Releases** ของโปรเจกต์
2. โหลดไฟล์ `BestchoiceCardReader-vX.X.X-win-x64.zip`
3. คลิกขวา → **Extract All** (แตกไฟล์)
4. เปิดโฟลเดอร์ที่แตกไฟล์ → ดับเบิลคลิก **`setup.bat`**
5. ทำตามที่โปรแกรมถาม → เสร็จ!

**ไม่ต้องลง Node.js** ไม่ต้องลงอะไรเพิ่ม — แค่โหลด แตกไฟล์ แล้ว setup จบ

### ใช้งาน

1. เสียบเครื่องอ่านบัตร USB เข้าคอม
2. ดับเบิลคลิก **"BESTCHOICE Card Reader"** บน Desktop
3. เสียบบัตรประชาชน → ระบบอ่านข้อมูลให้อัตโนมัติ

### สร้าง Release ใหม่ (สำหรับ Developer)

```bash
# Tag แล้ว push — GitHub Actions จะ build + สร้าง Release ให้อัตโนมัติ
git tag card-reader-v1.0.0
git push origin card-reader-v1.0.0
```

หรือกด **Actions → Build Card Reader → Run workflow** บน GitHub ก็ได้
