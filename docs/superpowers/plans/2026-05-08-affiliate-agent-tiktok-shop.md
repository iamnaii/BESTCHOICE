# Affiliate Marketing Agent — TikTok Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision Hermes profile #6 ("affiliate") with Telegram bot, multi-channel SQLite DB, ElevenLabs voice generation, TikTok Shop affiliate workflow skills, and cron jobs — enabling the owner to operate a 2-channel TikTok Shop affiliate side business with 8-12 hr/wk commitment.

**Architecture:** Reuse existing Hermes VM (`bestchoice-hermes/hermes-vm`). Provision new profile under `/home/hermes/.hermes/profiles/affiliate/` mirroring the `fon` profile pattern. Add `affiliate.db` SQLite (RW) + new MCP wrappers (`affiliate-db`, `elevenlabs-tts`). Define 11 skills as Markdown prompts (each maps to a Telegram command). Wire 5 cron jobs via Hermes CLI. New Telegram bot `@affiliate_secretary_bot`. Strict isolation: NO access to `business.db` or `personal.db`.

**Tech Stack:** Hermes CLI (`profile`, `mcp`, `skills`, `cron`), gcloud SSH IAP, SQLite, ElevenLabs API (Thai TTS), Telegram BotFather, BashTool for SSH-driven provisioning, Claude Sonnet 4.6 fallback for agent reasoning.

**Spec:** [docs/superpowers/specs/2026-05-08-affiliate-agent-tiktok-shop-design.md](../specs/2026-05-08-affiliate-agent-tiktok-shop-design.md)

---

## Constants (referenced throughout)

| Name | Value |
|---|---|
| VM | `hermes-vm` in `bestchoice-hermes` zone `asia-southeast1-c` |
| Profile dir | `/home/hermes/.hermes/profiles/affiliate/` |
| Profile data | `/home/hermes/data/affiliate.db` |
| MCP wrapper dir | `/home/hermes/data/mcp-bin/` |
| Systemd service | `hermes-gateway-affiliate.service` (user systemd) |
| Reference profile | `fon` (most recent, similar pattern) |
| Bot username | `@affiliate_secretary_bot` |

Standard SSH command pattern (referenced as `SSH(<command>)`):
```bash
gcloud compute ssh hermes-vm \
  --zone=asia-southeast1-c \
  --tunnel-through-iap \
  --project=bestchoice-hermes \
  --quiet --command='<command>'
```

Hermes user systemd prefix (referenced as `USER_SYSTEMD`):
```bash
sudo -u hermes -H XDG_RUNTIME_DIR=/run/user/$(id -u hermes) systemctl --user
```

---

## File Structure

| File | Purpose | Created in |
|---|---|---|
| `/home/hermes/.hermes/profiles/affiliate/config.yaml` | Profile config (provider, MCPs, allow-list) | Task 3 |
| `/home/hermes/.hermes/profiles/affiliate/SOUL.md` | Persona + scope + boundaries | Task 4 |
| `/home/hermes/.hermes/profiles/affiliate/context.md` | Channel definitions + product rules + TH calendar | Task 4 |
| `/home/hermes/.hermes/profiles/affiliate/skills/products/SKILL.md` | `/products` command logic | Task 6 |
| `/home/hermes/.hermes/profiles/affiliate/skills/script/SKILL.md` | `/script` command logic | Task 7 |
| `/home/hermes/.hermes/profiles/affiliate/skills/voiceover/SKILL.md` | `/voiceover` ElevenLabs invoker | Task 7 |
| `/home/hermes/.hermes/profiles/affiliate/skills/check-impulse/SKILL.md` | Product impulse-fit scorer | Task 6 |
| `/home/hermes/.hermes/profiles/affiliate/skills/check-claims/SKILL.md` | TikTok + อย. compliance check | Task 7 |
| `/home/hermes/.hermes/profiles/affiliate/skills/calendar/SKILL.md` | TH event calendar reader | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/skills/dashboard/SKILL.md` | Performance summary | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/skills/winners/SKILL.md` | Spark Ads candidate finder | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/skills/spark/SKILL.md` | Spark Ads boost recommender | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/skills/budget/SKILL.md` | Budget allocation suggester | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/skills/inbox/SKILL.md` | TikTok DM/comment summarizer | Task 8 |
| `/home/hermes/.hermes/profiles/affiliate/cron/*.cron` | 5 scheduled jobs | Task 9 |
| `/home/hermes/data/affiliate.db` | SQLite DB (RW per profile) | Task 5 |
| `/home/hermes/data/affiliate-seed.sql` | Schema + seed data | Task 5 |
| `/home/hermes/data/mcp-bin/affiliate-db` | SQLite MCP wrapper | Task 3 |
| `/home/hermes/data/mcp-bin/elevenlabs-tts` | ElevenLabs API wrapper | Task 3 |
| `/home/hermes/data/affiliate-import.sh` | TikTok Shop CSV importer | Task 10 |
| `/etc/systemd/system/user@.service.d/...` (referenced via `--user`) | hermes-gateway-affiliate.service | Task 3 |
| Local: `/tmp/affiliate-prereqs.md` | Owner prerequisite collection notes | Task 1 |

---

## Task 1: Owner prerequisite collection

**Files (created locally):**
- Create: `/tmp/affiliate-prereqs.md`

This task collects the credentials + handles from the owner. **Cannot proceed without these** — they require owner ID/login and cannot be Claude-automated.

- [ ] **Step 1: Print prerequisites checklist**

```bash
cat > /tmp/affiliate-prereqs.md <<'EOF'
# Affiliate Agent — Owner Prerequisites (UPDATED for AI-Avatar)

Owner needs to gather these BEFORE Task 2 can proceed:

## A. TikTok Shop registration (~30 min)
- [ ] Visit https://seller-th.tiktok.com/account/register
- [ ] Register as **Marketing Account** (NOT Creator) — bypasses 1k follower requirement
- [ ] Verify Thai national ID + business documents
- [ ] Note the Shop ID once approved
- [ ] **Field needed:** TIKTOK_SHOP_ID

## B. TikTok account creation (~15 min × 2)
- [ ] Create 2 fresh TikTok accounts:
  - Channel 1 (Home/Kitchen): suggested handles `homemate.th`, `findsby.you`, `homehacks.daily`
  - Channel 2 (Phone/Gadget): suggested handles `gadgetdrip.th`, `techfinds.daily`
- [ ] Bio: do NOT mention or link to BESTCHOICE (privacy stance — Q3=A)
- [ ] Link both to TikTok Shop Marketing Account
- [ ] **Fields needed:** HOME_HANDLE, GADGET_HANDLE

## C. Telegram bot creation (~5 min)
- [ ] Open Telegram, message @BotFather
- [ ] Send `/newbot`
- [ ] Bot name: "เลขา Affiliate"
- [ ] Bot username: `affiliate_secretary_bot`
- [ ] **Field needed:** TG_BOT_TOKEN

## D. ElevenLabs subscription (~5 min)
- [ ] Visit https://elevenlabs.io/sign-up
- [ ] Subscribe to **Creator tier ($22/mo, 100 min audio)**
- [ ] Voice library → pick 2 Thai voices (stock voices, NO clone — Q1=A):
  - Voice 1 (Home channel): warm female "เพื่อนแชร์ของถูก"
  - Voice 2 (Gadget channel): neutral mid-tone "นักรีวิวสายเทค"
- [ ] Settings → API Keys → Create
- [ ] **Fields needed:** ELEVENLABS_API_KEY, ELEVENLABS_HOME_VOICE_ID, ELEVENLABS_GADGET_VOICE_ID

## E. Owner Telegram ID (~1 min)
- [ ] Message @userinfobot → returns numeric ID
- [ ] **Field needed:** OWNER_TG_ID

## F. HeyGen subscription (~10 min) — NEW for AI-avatar
- [ ] Visit https://www.heygen.com/pricing
- [ ] Subscribe to **Starter $29/mo** (covers ~10 mins of avatar video/mo)
- [ ] Account → Avatars → Create Avatar from photos
- [ ] Upload **10-20 reference photos** of owner (see Section H below)
- [ ] Wait 5-15 min for avatar training to complete
- [ ] Note the trained Avatar ID
- [ ] Settings → API → Generate API Key
- [ ] **Fields needed:** HEYGEN_API_KEY, HEYGEN_AVATAR_ID

## G. Hedra subscription (~5 min) — NEW for lip sync (optional)
- [ ] Visit https://www.hedra.com/pricing
- [ ] Subscribe **Pro $30/mo** (or skip — re-evaluate Week 2)
- [ ] Settings → API Keys → Create
- [ ] **Field needed:** HEDRA_API_KEY (or "skip")

## H. Reference photos (~30 min) — NEW for AI-avatar training

Owner needs to take 10-20 photos of themselves with these requirements:

**Coverage:**
- 5+ front-facing (looking at camera, neutral + smiling + talking-mid)
- 2-3 ¾ profile (left + right turns)
- 2-3 full profile (both sides)
- Indoor + outdoor lighting variants
- Same hairstyle/glasses across all photos (avatar trains on consistency)
- Resolution ≥ 1024×1024 px
- Face well-lit, no shadows on face
- Plain background preferred (or simple)

**Avoid:**
- Sunglasses, hats blocking face
- Heavy filters / makeup difference between photos
- Photos with multiple people
- Low-light/blurry shots

**Action:**
- Save 10-20 photos in a folder, ZIP it
- Upload ZIP to HeyGen during avatar creation
- Also keep ZIP on local machine — will upload to Higgsfield in Task 3

## I. Higgsfield reuse (~10 sec)
- [ ] Confirm reuse of existing Higgsfield credentials (already on VM)
- [ ] **Field needed:** HIGGSFIELD_REUSE (true|false)

## J. (Optional) Voice sample
- [ ] If at any point owner wants voice clone (Phase 4+), record 90 sec of clear Thai speech
- [ ] **Field needed:** Defer — collect at Phase 4 if needed

---

## Summary fields to provide back to Claude:

```
TIKTOK_SHOP_ID=
HOME_HANDLE=
GADGET_HANDLE=
TG_BOT_TOKEN=
ELEVENLABS_API_KEY=
ELEVENLABS_HOME_VOICE_ID=
ELEVENLABS_GADGET_VOICE_ID=
OWNER_TG_ID=
HEYGEN_API_KEY=
HEYGEN_AVATAR_ID=
HEDRA_API_KEY=          # or "skip"
HIGGSFIELD_REUSE=true|false
```

12 fields total. After collecting these fields, proceed to Task 2.
EOF

cat /tmp/affiliate-prereqs.md
```
Expected: Prints the checklist for owner to complete.

- [ ] **Step 2: Pause for owner**

Print to chat:
> "Task 1 — Owner prerequisites checklist saved to `/tmp/affiliate-prereqs.md`. Please complete A-F above and reply with the SUMMARY FIELDS block. I'll resume from Task 2 once received."

**Wait state:** Plan execution pauses until owner provides all 9 fields. Subagent-driven mode: this is the human gate.

- [ ] **Step 3: Commit checkpoint**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add docs/superpowers/plans/2026-05-08-affiliate-agent-tiktok-shop.md
git commit -m "docs: implementation plan for affiliate marketing agent (TikTok Shop)"
```

---

## Task 2: Pre-flight VM verification

**Files:** none modified

- [ ] **Step 1: Verify VM healthy**

```bash
gcloud compute instances describe hermes-vm \
  --zone=asia-southeast1-c \
  --project=bestchoice-hermes \
  --format='value(status)'
```
Expected: `RUNNING`

- [ ] **Step 2: Verify existing 5 profiles still active**

`SSH('USER_SYSTEMD is-active hermes-gateway-personal hermes-gateway-golf hermes-gateway-bc-cmo hermes-gateway-bc-cfo hermes-gateway-fon')`

Expected: 5 lines of `active`

- [ ] **Step 3: Verify fon profile structure (template to mirror)**

`SSH('ls -la /home/hermes/.hermes/profiles/fon/')`

Expected: shows `config.yaml`, `SOUL.md`, possibly `context.md`, `skills/`, etc. — **note this structure for Tasks 3-4**.

- [ ] **Step 4: Verify VM disk + memory headroom**

`SSH('df -h /home/hermes && free -h')`

Expected: > 1GB free disk, > 500MB free memory (5 profiles already running). If tight, halt and bump VM size first.

- [ ] **Step 5: Confirm port availability**

`SSH('ss -tlnp 2>/dev/null | grep -E "8642|8643|8644|8645|8646|8647" || echo "Open ports above 8647 available"')`

Expected: existing 5 profiles use 8642-8646; **8647 reserved for affiliate gateway**.

---

## Task 3: Provision affiliate profile (filesystem + systemd)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/config.yaml`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/home/.config/` (HOME isolation per pattern)
- Create on VM: `/home/hermes/data/mcp-bin/affiliate-db`
- Create on VM: `/home/hermes/data/mcp-bin/elevenlabs-tts`
- Modify: user systemd unit `hermes-gateway-affiliate.service`

- [ ] **Step 1: Create profile directory tree**

`SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/{skills,cron,home/.config} && sudo -u hermes mkdir -p /home/hermes/data/{voiceovers,renders,reference-photos}')`

Expected: no error.

- [ ] **Step 2: Write config.yaml (mirror fon, swap port + bot, add new MCPs)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/config.yaml <<YAML
profile: affiliate
provider:
  primary: openai-codex
  fallback: claude-sonnet-4-6
gateway:
  port: 8647
  bind: 127.0.0.1
telegram:
  bot_token_env: AFFILIATE_TG_BOT_TOKEN
  allow_list:
    - <OWNER_TG_ID>          # replace with value from Task 1
mcp:
  - affiliate-db
  - elevenlabs-tts
  - heygen-render            # NEW for AI-avatar
  - higgsfield               # reuse if HIGGSFIELD_REUSE=true
  - google-calendar
home_dir: /home/hermes/.hermes/profiles/affiliate/home
YAML
')
```

Expected: config file written. **Substitute `<OWNER_TG_ID>` with actual value from Task 1.**

- [ ] **Step 3: Write affiliate-db MCP wrapper**

```bash
SSH('sudo -u hermes tee /home/hermes/data/mcp-bin/affiliate-db <<SHELL
#!/bin/bash
export HOME=/home/hermes
exec /home/hermes/.local/bin/mcp-sqlite \
  --db /home/hermes/data/affiliate.db \
  --read-write \
  "\$@"
SHELL
sudo -u hermes chmod +x /home/hermes/data/mcp-bin/affiliate-db')
```

Expected: file written + executable.

- [ ] **Step 4: Write elevenlabs-tts MCP wrapper**

```bash
SSH('sudo -u hermes tee /home/hermes/data/mcp-bin/elevenlabs-tts <<SHELL
#!/bin/bash
export HOME=/home/hermes
export ELEVENLABS_API_KEY=<ELEVENLABS_API_KEY>
exec /home/hermes/.local/bin/mcp-elevenlabs "\$@"
SHELL
sudo -u hermes chmod 700 /home/hermes/data/mcp-bin/elevenlabs-tts')
```

Expected: file written, mode 700 (contains API key).

**Note:** if `mcp-elevenlabs` binary does not exist on VM, fallback to inline curl wrapper:

```bash
SSH('sudo -u hermes tee /home/hermes/data/mcp-bin/elevenlabs-tts <<SHELL
#!/bin/bash
# Stub: curl-based fallback
# Args: voice_id text output_path
curl -X POST "https://api.elevenlabs.io/v1/text-to-speech/\$1" \
  -H "xi-api-key: <ELEVENLABS_API_KEY>" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"\$2\",\"model_id\":\"eleven_multilingual_v2\"}" \
  --output "\$3"
SHELL
sudo -u hermes chmod 700 /home/hermes/data/mcp-bin/elevenlabs-tts')
```

- [ ] **Step 4.5: Write heygen-render MCP wrapper (NEW)**

```bash
SSH('sudo -u hermes tee /home/hermes/data/mcp-bin/heygen-render <<SHELL
#!/bin/bash
# HeyGen avatar video generation
# Args: avatar_id audio_path output_path
export HOME=/home/hermes
export HEYGEN_API_KEY=<HEYGEN_API_KEY>

AVATAR_ID="\$1"
AUDIO="\$2"
OUTPUT="\$3"

# Step 1: Upload audio file to HeyGen, get audio_asset_id
AUDIO_ID=\$(curl -s -X POST https://api.heygen.com/v1/asset \
  -H "X-API-KEY: \$HEYGEN_API_KEY" \
  -F "file=@\$AUDIO" | jq -r ".data.id")

if [ -z "\$AUDIO_ID" ] || [ "\$AUDIO_ID" = "null" ]; then
  echo "ERROR: HeyGen audio upload failed" >&2
  exit 1
fi

# Step 2: Create video generation job
JOB_ID=\$(curl -s -X POST https://api.heygen.com/v2/video/generate \
  -H "X-API-KEY: \$HEYGEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"video_inputs\":[{\"character\":{\"type\":\"avatar\",\"avatar_id\":\"\$AVATAR_ID\",\"avatar_style\":\"normal\"},\"voice\":{\"type\":\"audio\",\"audio_asset_id\":\"\$AUDIO_ID\"}}],\"dimension\":{\"width\":1080,\"height\":1920}}" \
  | jq -r ".data.video_id")

# Step 3: Poll for completion (max 5 min)
for i in \$(seq 1 30); do
  STATUS=\$(curl -s "https://api.heygen.com/v1/video_status.get?video_id=\$JOB_ID" \
    -H "X-API-KEY: \$HEYGEN_API_KEY" | jq -r ".data.status")
  if [ "\$STATUS" = "completed" ]; then
    URL=\$(curl -s "https://api.heygen.com/v1/video_status.get?video_id=\$JOB_ID" \
      -H "X-API-KEY: \$HEYGEN_API_KEY" | jq -r ".data.video_url")
    curl -sL "\$URL" -o "\$OUTPUT"
    exit 0
  elif [ "\$STATUS" = "failed" ]; then
    echo "ERROR: HeyGen render failed" >&2
    exit 1
  fi
  sleep 10
done

echo "ERROR: HeyGen render timed out" >&2
exit 1
SHELL
sudo -u hermes chmod 700 /home/hermes/data/mcp-bin/heygen-render')
```

**Substitute `<HEYGEN_API_KEY>` from Task 1.**

- [ ] **Step 5: Symlink Higgsfield credentials (per existing pattern)**

```bash
SSH('sudo -u hermes ln -sfn /home/hermes/.config/higgsfield /home/hermes/.hermes/profiles/affiliate/home/.config/higgsfield')
```

Expected: symlink created.

- [ ] **Step 6: Create systemd user service**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.config/systemd/user && \
sudo -u hermes tee /home/hermes/.config/systemd/user/hermes-gateway-affiliate.service <<UNIT
[Unit]
Description=Hermes Gateway (affiliate profile)
After=network-online.target

[Service]
Type=simple
Environment="HOME=/home/hermes"
Environment="AFFILIATE_TG_BOT_TOKEN=<TG_BOT_TOKEN>"
ExecStart=/home/hermes/.local/bin/hermes gateway run --profile affiliate
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
')
```

**Substitute `<TG_BOT_TOKEN>` from Task 1.**

- [ ] **Step 7: Reload + enable service**

```bash
SSH('USER_SYSTEMD daemon-reload && USER_SYSTEMD enable hermes-gateway-affiliate')
```

Expected: no error.

- [ ] **Step 8: Verify config syntax**

```bash
SSH('sudo -u hermes /home/hermes/.local/bin/hermes profile validate affiliate')
```
Expected: `Profile "affiliate" valid` or equivalent. If fails, read error and fix config.yaml before continuing.

- [ ] **Step 9: Commit checkpoint**

No local files changed in this task — commit a note instead in next plan-touching task.

---

## Task 4: SOUL.md + context.md (persona + domain context)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/SOUL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/context.md`

- [ ] **Step 1: Write SOUL.md (persona, scope, allow-list, boundaries)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/SOUL.md <<MD
# SOUL — affiliate profile

## Identity
You are the affiliate marketing operations assistant for the owner. You help operate
a TikTok Shop Affiliate side business across 2 channels: **Home/Kitchen gadgets** and
**Phone accessories/Gadget**. Your tone is concise, action-oriented, "เรา/ครับ"
junior-performance-marketer voice — neither hyper-friendly nor formal.

## Scope (what you do)
- Research trending TikTok Shop products per channel
- Score products for impulse-buy fit (price/demo/pain/trust)
- Generate Thai scripts for 30/60-sec faceless videos
- Invoke ElevenLabs to produce voiceover mp3
- Run compliance checks (TikTok Guidelines + Thai FDA cosmetic claims)
- Track per-video and per-channel performance
- Recommend Spark Ads boost decisions
- Recommend budget rebalancing across channels
- Summarize TikTok DMs/comments

## Standing instructions
- Default channel context: ask "home" or "gadget" when ambiguous
- Always enforce **price ceiling 499฿** (max 799฿ exception with warning) on product picks
- Reject any cosmetic/health/efficacy claim that requires อย. proof — replace with neutral wording
- Never auto-boost Spark Ads > 500฿/day without explicit Telegram confirm
- Never claim a product is the best/cheapest/only — soften to "ลองดู", "ตัวที่เราเจอน่าสนใจ"
- For LIVE selling questions, defer — out of Phase 1 scope

## Privacy boundaries
- NO access to business.db (BESTCHOICE business data)
- NO access to personal.db (owner personal data)
- Allow-list: owner Telegram ID ONLY — refuse any other user politely

## Stop-loss triggers (alert owner immediately)
- Any channel ROAS < 0.7 for 2 consecutive weeks
- Monthly ad burn projected > 80k
- Clawback rate > 15% on any channel
- Any TikTok account ban or shadowban signal
MD
')
```

Expected: file written.

- [ ] **Step 2: Write context.md (channel definitions + product rules + TH calendar)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/context.md <<MD
# Context — affiliate profile

## Channels

### Channel 1: home (Home/Kitchen Gadgets)
- Audience: หญิง 25-50, แม่บ้าน, working women, cooking enthusiasts
- Voice persona: ผู้หญิงเสียงนุ่ม "เพื่อนแชร์ของถูก"
- ElevenLabs voice ID: <ELEVENLABS_HOME_VOICE_ID>
- Hook style: "เคยเหนื่อยทำ X ไหม?" / "รู้ไหมว่ามีของแบบนี้?"
- Posting times: 11:00, 19:00 (Asia/Bangkok)
- TikTok handle: @<HOME_HANDLE>
- Sub-niches: Cleaning gadgets, kitchen tools, organizing, home repair, pest control
- Price range: 99-399฿
- Commission expected: 8-15%
- Hashtag pool: #หาของน่าใช้, #ไอเทมแม่บ้าน, #ครัวต้องมี, #ของใช้จำเป็น

### Channel 2: gadget (Phone Accessories / Gadget)
- Audience: ทุกเพศ 18-40, tech-curious, students, office workers
- Voice persona: กลางๆ neutral "นักรีวิวสายเทค"
- ElevenLabs voice ID: <ELEVENLABS_GADGET_VOICE_ID>
- Hook style: "รู้ไหมว่าโทรศัพท์เก่าก็..." / "อันนี้แก้ปัญหาทุกคนเคยเจอ"
- Posting times: 12:00, 20:00, 22:00
- TikTok handle: @<GADGET_HANDLE>
- Sub-niches: Phone holders, cable organizers, screen cleaners, mini speakers, USB gadgets, LED, mini fans
- Price range: 99-399฿
- Commission expected: 5-12%
- Hashtag pool: #ของกาดเจ็ต, #รีวิวอุปกรณ์, #gadgetth, #ของเทคไอเดียเด็ด

## Product Selection Rules (impulse filter)

A product passes ALL 5 rules to enter workflow:
1. Price ≤ 499฿ (preferred 99-299฿)
2. Demo-able in ≤ 10 sec
3. Pain → Solution clarity in 3 sec
4. Return rate < 5% (check seller history)
5. Commission ≥ 5% AND commission/sale ≥ 20฿

Excluded categories: skincare, supplements, fashion clothing, electronics > 1k฿, food perishable.

## Content Format (30-60 sec)
[0-3s]   HOOK: ปัญหา POV
[3-8s]   PAIN: วิธีเดิมแย่ยังไง
[8-20s]  SOLUTION: สินค้า demo close-up
[20-40s] RESULT: before/after, satisfying
[40-55s] CTA: "กดตะกร้าด้านล่าง" + urgency
[55-60s] LOOP back to hook

## Stop-loss thresholds
- Per-video kill: views <500 (24hr), CTR <1%, completion <10%, cart-add <0.3%
- Per-channel weekly: avg CTR <2%, avg ROAS <0.7, avg revenue/wk <1k, clawback >15%

## Budget rules
- Initial allocation: 25k/channel/month (50k total) starting Week 5
- Weeks 1-4: organic only, 0฿ ads
- Spark Ads: only on videos with organic CTR>5% + completion>30%
- Daily budget tiers: Top 1% video → 2-3k/day, Top 5% → 800-1.5k/day, Top 10% → 500-800/day
- Rebalance trigger: ROAS gap > 1.0 between channels for 2 wks → shift 30%

## TH Event Calendar (90-day rolling, see events table for full)
- Songkran: April 13-15
- Mother Day: August 12
- Payday: 25-30 of every month
- Father Day: December 5
- New Year: December 31 - January 2
- BTS school return: May, October
MD
')
```

**Substitute** `<ELEVENLABS_HOME_VOICE_ID>`, `<ELEVENLABS_GADGET_VOICE_ID>`, `<HOME_HANDLE>`, `<GADGET_HANDLE>` from Task 1.

- [ ] **Step 3: Verify markdown renders**

```bash
SSH('head -30 /home/hermes/.hermes/profiles/affiliate/SOUL.md && echo "---" && head -30 /home/hermes/.hermes/profiles/affiliate/context.md')
```
Expected: clean markdown content shown.

---

## Task 5: SQLite database initialization + seed

**Files:**
- Create on VM: `/home/hermes/data/affiliate-seed.sql`
- Create on VM: `/home/hermes/data/affiliate.db`

- [ ] **Step 1: Write schema + seed SQL**

```bash
SSH('sudo -u hermes tee /home/hermes/data/affiliate-seed.sql <<SQL
-- Affiliate agent SQLite schema (created 2026-05-08)
PRAGMA foreign_keys = ON;

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  audience TEXT,
  voice_id TEXT,
  hook_style TEXT,
  posting_times TEXT,
  hashtags TEXT,
  tiktok_handle TEXT,
  status TEXT NOT NULL DEFAULT "active"
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  name TEXT NOT NULL,
  price_thb DECIMAL(10,2),
  commission_pct DECIMAL(5,2),
  return_rate_pct DECIMAL(5,2),
  impulse_score INTEGER,
  category TEXT,
  shop_name TEXT,
  affiliate_link TEXT,
  status TEXT NOT NULL DEFAULT "pending",
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  notes TEXT
);
CREATE INDEX idx_products_channel_status ON products(channel_id, status);

CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  channel_id TEXT NOT NULL REFERENCES channels(id),
  hook TEXT,
  body TEXT,
  cta TEXT,
  duration_sec INTEGER,
  voice_path TEXT,
  compliance_passed INTEGER,
  compliance_issues TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  tiktok_video_id TEXT UNIQUE,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  script_id TEXT REFERENCES scripts(id),
  product_id TEXT REFERENCES products(id),
  content_type TEXT NOT NULL CHECK (content_type IN ("review","tip","story","trend")),
  posted_at DATETIME,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  cart_clicks INTEGER NOT NULL DEFAULT 0,
  ctr_pct DECIMAL(5,2),
  completion_pct DECIMAL(5,2),
  status TEXT NOT NULL DEFAULT "live",
  last_synced_at DATETIME
);
CREATE INDEX idx_videos_channel_status ON videos(channel_id, status);
CREATE INDEX idx_videos_posted_at ON videos(posted_at);
CREATE INDEX idx_videos_content_type ON videos(channel_id, content_type, posted_at);

CREATE TABLE revenue (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  video_id TEXT REFERENCES videos(id),
  order_id TEXT UNIQUE,
  product_id TEXT REFERENCES products(id),
  gmv_thb DECIMAL(10,2),
  commission_thb DECIMAL(10,2),
  status TEXT NOT NULL,
  ordered_at DATETIME,
  delivered_at DATETIME,
  payout_at DATETIME,
  clawback_at DATETIME,
  notes TEXT
);
CREATE INDEX idx_revenue_channel_status ON revenue(channel_id, status);
CREATE INDEX idx_revenue_ordered_at ON revenue(ordered_at);

CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  video_id TEXT REFERENCES videos(id),
  spend_thb DECIMAL(10,2) NOT NULL DEFAULT 0,
  attributed_revenue_thb DECIMAL(10,2) NOT NULL DEFAULT 0,
  roas DECIMAL(5,2),
  status TEXT NOT NULL,
  started_at DATETIME,
  ended_at DATETIME
);
CREATE INDEX idx_ads_channel_status ON ad_campaigns(channel_id, status);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  hook_template TEXT,
  applies_to_channels TEXT
);
CREATE INDEX idx_events_date ON events(date);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed channels
INSERT INTO channels (id, name, audience, voice_id, hook_style, posting_times, hashtags, tiktok_handle, status) VALUES
("home", "Home/Kitchen Gadgets",
 "หญิง 25-50, แม่บ้าน, working women",
 "<ELEVENLABS_HOME_VOICE_ID>",
 "เคยเหนื่อยทำ X ไหม?",
 "[\"11:00\",\"19:00\"]",
 "[\"#หาของน่าใช้\",\"#ไอเทมแม่บ้าน\",\"#ครัวต้องมี\"]",
 "@<HOME_HANDLE>",
 "active"),
("gadget", "Phone/Gadget",
 "ทุกเพศ 18-40, tech-curious",
 "<ELEVENLABS_GADGET_VOICE_ID>",
 "อันนี้แก้ปัญหาทุกคนเคยเจอ",
 "[\"12:00\",\"20:00\",\"22:00\"]",
 "[\"#ของกาดเจ็ต\",\"#รีวิวอุปกรณ์\",\"#gadgetth\"]",
 "@<GADGET_HANDLE>",
 "active");

-- Seed initial settings
INSERT INTO settings (key, value) VALUES
("monthly_ad_budget_thb", "50000"),
("ad_budget_per_channel_thb", "25000"),
("kill_threshold_roas", "0.7"),
("scale_threshold_roas", "1.5"),
("price_ceiling_thb", "499"),
("price_max_thb", "799"),
("min_commission_pct", "5"),
("min_commission_per_sale_thb", "20"),
("phase", "1"),
("ads_unlocked", "false"),
("content_mix_review_pct", "60"),
("content_mix_tip_pct", "20"),
("content_mix_story_pct", "10"),
("content_mix_trend_pct", "10"),
("heygen_avatar_id", ""),
("heygen_api_key_set", "false"),
("hedra_enabled", "false");

-- Seed TH events (90 days from 2026-05-08)
INSERT INTO events (id, date, name, category, hook_template, applies_to_channels) VALUES
("e1", "2026-05-25", "เงินเดือนออก", "payday", "เงินเดือนเข้าเเล้วใช่ไหม? อันนี้ดี + ราคาเบาๆ", "[\"home\",\"gadget\"]"),
("e2", "2026-05-30", "เงินเดือนออก (รอบ 30)", "payday", "ของเล็กๆ ลด stress ใช้เงินเดือนนิดเดียว", "[\"home\",\"gadget\"]"),
("e3", "2026-06-09", "วันเด็กของไทย", "cultural", "ของเด็กๆ ใช้ได้นานๆ", "[\"home\"]"),
("e4", "2026-06-25", "เงินเดือนออก", "payday", "เงินเดือนเข้า — ลองของชิ้นนี้", "[\"home\",\"gadget\"]"),
("e5", "2026-07-25", "เงินเดือนออก", "payday", "ของจำเป็นเก็บไว้ใช้ยาวๆ", "[\"home\",\"gadget\"]"),
("e6", "2026-08-12", "วันแม่", "cultural", "ของขวัญแม่ — ใช้ทุกวัน ราคาไม่แรง", "[\"home\",\"gadget\"]"),
("e7", "2026-08-25", "เงินเดือนออก", "payday", NULL, "[\"home\",\"gadget\"]");

SQL
')
```

**Substitute** all 4 placeholder tokens from Task 1.

- [ ] **Step 2: Initialize DB**

```bash
SSH('sudo -u hermes sqlite3 /home/hermes/data/affiliate.db < /home/hermes/data/affiliate-seed.sql && \
sudo -u hermes chmod 600 /home/hermes/data/affiliate.db')
```

Expected: no error.

- [ ] **Step 3: Verify schema + seed**

```bash
SSH('sudo -u hermes sqlite3 /home/hermes/data/affiliate.db ".tables" && \
echo "---" && \
sudo -u hermes sqlite3 /home/hermes/data/affiliate.db "SELECT id, name FROM channels;" && \
echo "---" && \
sudo -u hermes sqlite3 /home/hermes/data/affiliate.db "SELECT key, value FROM settings WHERE key IN (\"monthly_ad_budget_thb\",\"phase\");"')
```

Expected:
- 8 tables: channels, products, scripts, videos, revenue, ad_campaigns, events, settings
- 2 channels: home, gadget
- 2 settings: monthly_ad_budget_thb=50000, phase=1

---

## Task 6: Skills batch 1 — Research (`/products`, `/check-impulse`)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/products/SKILL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/check-impulse/SKILL.md`

- [ ] **Step 1: Write `/products` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/products && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/products/SKILL.md <<MD
---
name: products
description: Show top trending TikTok Shop products filtered by impulse rules per channel
---

# /products [home|gadget]

Trigger: user types `/products` or `/products home` or `/products gadget` or natural Thai equivalent ("ของเด็ดวันนี้", "หาสินค้าน่าปัก").

Steps:
1. If channel not specified, ask: "เลือกช่อง home หรือ gadget?"
2. Query DB for already-tracked products in last 14 days (avoid duplicates):
   \`\`\`sql
   SELECT id FROM products WHERE channel_id = ? AND added_at > DATE("now", "-14 days");
   \`\`\`
3. Reference channel context.md for sub-niches + price range.
4. **Manual TikTok Affiliate Center step:** Hermes does NOT have a public TikTok Shop API. Instruct owner:
   > "เปิด TikTok Shop Affiliate Center → Marketplace → filter by category [SUB_NICHE], price 99-499฿, sort by sales rank → screenshot top 20 หรือ export CSV ส่งกลับ"
5. When owner sends product list (pasted or CSV), parse + apply impulse filter (call `/check-impulse` per item).
6. Score + rank top 5, insert into `products` table with status=pending.
7. Reply with table:

   \`\`\`
   เด่นวันนี้ (channel: home)
   1. <name> | 199฿ | 12% | impulse 85 | ✓
   2. <name> | 299฿ | 10% | impulse 78 | ✓
   ...
   ตอบ "เลือก 1,3,5" เพื่อ approve
   \`\`\`
8. On approval, update status=approved.

Output format: Markdown table, max 5 picks, max 200 words.
MD
')
```

- [ ] **Step 2: Write `/check-impulse` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/check-impulse && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/check-impulse/SKILL.md <<MD
---
name: check-impulse
description: Score a product 0-100 for faceless impulse-buy fit
---

# /check-impulse <product>

Trigger: `/check-impulse <name>` or "อันนี้น่าปักไหม?" with product info.

Score 0-100 based on 5 dimensions (20 points each):

1. **Price** (≤299฿: 20pts, 300-499฿: 15pts, 500-799฿: 10pts, >799฿: 0pts → REJECT)
2. **Demo-able** (visible result in ≤10s: 20pts, requires explanation: 10pts, abstract: 0pts)
3. **Pain clarity** (universal pain in 3s: 20pts, niche pain: 10pts, no clear pain: 0pts)
4. **Trust requirement** (no trust needed (visual=proof): 20pts, low (gadget): 15pts, high (skincare/supplement): 0pts → REJECT)
5. **Commission economics** (>20฿/sale + >5%: 20pts, 10-20฿: 10pts, <10฿: 0pts → REJECT)

Auto-reject categories regardless of score:
- Skincare/cosmetics requiring เครื่องสำอาง claims
- Supplements/health drinks
- Fashion clothing (size returns)
- Food perishable

Output format:
\`\`\`
Product: <name>
Score: 78/100 ✓ APPROVED
- Price: 15/20 (399฿ — กลาง)
- Demo: 20/20 (3-step demo ชัด)
- Pain: 20/20 (ปัญหาทั่วไป)
- Trust: 18/20 (gadget low-trust)
- Commission: 5/20 (45฿/sale × 12%)
Recommendation: pin to channel <home|gadget>
\`\`\`

If REJECT:
\`\`\`
Product: <name>
Score: 35/100 ✗ REJECTED
Reason: requires อย. proof (skincare claim)
Suggestion: skip, find different SKU
\`\`\`
MD
')
```

- [ ] **Step 3: Test skill activation**

```bash
SSH('sudo -u hermes /home/hermes/.local/bin/hermes profile use affiliate && \
sudo -u hermes /home/hermes/.local/bin/hermes skills list')
```

Expected: shows `products`, `check-impulse` (and any inherited skills).

---

## Task 7: Skills batch 2 — Content (`/script`, `/avatar-script`, `/voiceover`, `/avatar-render`, `/check-claims`)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/script/SKILL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/avatar-script/SKILL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/voiceover/SKILL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/avatar-render/SKILL.md`
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/check-claims/SKILL.md`

- [ ] **Step 1: Write `/script` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/script && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/script/SKILL.md <<MD
---
name: script
description: Generate Thai 30/60-sec faceless TikTok script following Hook→Pain→Solution→Result→CTA pattern
---

# /script <product> [--channel home|gadget] [--duration 30|60]

Trigger: `/script <product_id>` or "เขียน script ให้สินค้า X".

Steps:
1. Look up product in DB: name, price, commission, sub-niche
2. Use channel context (voice persona, hook style) from context.md
3. Generate 5 sections following the format:

   - **Hook (3s)** — POV ปัญหา + voice line
   - **Pain (5s)** — describe inefficiency of old way
   - **Solution (12s)** — product appears, demo close-up steps
   - **Result (20s)** — before/after, ASMR satisfying
   - **CTA (15s)** — "กดตะกร้าด้านล่าง" + 1 urgency hook (limited stock, today price, free shipping)
   - **Loop (5s)** — return to hook line

4. Tone matches channel:
   - home: ผู้หญิงเสียงนุ่ม "เพื่อนแชร์ของถูก", "คือเรา..."
   - gadget: กลางๆ neutral "นักรีวิวสายเทค", "ลองดูอันนี้"

5. Avoid: superlatives ("ดีที่สุด"), อย. claims, brand bashing
6. Insert script into `scripts` table with compliance_passed=null
7. Auto-call `/check-claims <script_id>` next
8. Output:

\`\`\`
Script ID: SC-2026-05-08-001
Channel: home
Duration: 60s
---
[HOOK 0-3s]
[Voice]: เคยล้างจานนานๆ จนมือเปื่อยไหม?
[Visual]: POV ล้างจาน, มือเปียก

[PAIN 3-8s]
[Voice]: ฟองน้ำเก่าก็ขึ้นรา ใช้แปรงมือก็เจ็บ...
[Visual]: ฟองน้ำดำๆ เลอะ

[SOLUTION 8-20s]
[Voice]: ลองอันนี้สิ — แปรงล้างจาน silicone หัวนุ่ม...
[Visual]: close-up product demo

... etc
\`\`\`

Word limit: ≤200 Thai words for 60s, ≤100 for 30s.
MD
')
```

- [ ] **Step 1.5: Write `/avatar-script` skill (NEW for non-product content)**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/avatar-script && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/avatar-script/SKILL.md <<MD
---
name: avatar-script
description: Generate Thai script for non-product content (tips/story/trend) — for AI-avatar talking-head
---

# /avatar-script <topic> --type tip|story|trend --channel home|gadget [--duration 30|45|60]

Trigger: `/avatar-script <topic>` when topic is NOT tied to a specific product.

## Type-specific formats

### type=tip (Tips/Hacks/Edutainment, 30-45s)
\`\`\`
[0-3s]   HOOK: AI-avatar (owner) "5 ทริค X ที่ไม่มีใครบอก"
[3-8s]   Context: ทำไมเรื่องนี้สำคัญ
[8-35s]  Tips 1-5 (5-7 sec each), AI-avatar inset on b-roll
[35-45s] CTA: "follow ไว้เผื่อมีของดี" (NO product link)
\`\`\`

### type=story (Behind-the-scenes/Story, 30-60s)
\`\`\`
[0-3s]   HOOK: AI-avatar "วันนี้เจอเรื่อง..." or "เล่าให้ฟัง..."
[3-50s]  Narrative + b-roll context
[50-60s] Soft CTA: "follow เผื่อมีเรื่องเล่าทุกอาทิตย์" (NO product link)
\`\`\`

### type=trend (TikTok Trend adapt, 15-30s)
\`\`\`
Identify trending audio/format → AI-avatar adapt to channel niche
e.g., trend "5 things in my bag" → "5 things in my kitchen drawer" for home channel
\`\`\`

## Insert into scripts table

\`\`\`sql
INSERT INTO scripts (id, product_id, channel_id, hook, body, cta, duration_sec, ...)
VALUES ("AS-...", NULL, ?, ?, ?, ?, ?, ...);
\`\`\`

Note: product_id is NULL for non-product content. Track via videos.content_type.

Output:
\`\`\`
Avatar Script ID: AS-2026-05-08-001
Channel: home
Type: tip
Duration: 45s
---
[HOOK]: 5 ทริคล้างจานเร็วขึ้น ที่หาย่าหายนาน
[TIP 1]: ใส่น้ำมะนาวก่อน ฟองง่ายขึ้น
[TIP 2]: แช่ก่อน 5 นาที ขัดน้อยลง
... etc
\`\`\`
MD
')
```

- [ ] **Step 2: Write `/voiceover` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/voiceover && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/voiceover/SKILL.md <<MD
---
name: voiceover
description: Convert script to mp3 via ElevenLabs Thai voice
---

# /voiceover <script_id>

Trigger: `/voiceover SC-2026-05-08-001` or "อัดเสียงให้ script SC-XXX".

Steps:
1. Fetch script + channel from DB
2. Get voice_id from channel record
3. Concatenate all [Voice]: lines into single text (strip [Visual] cues)
4. Call elevenlabs-tts MCP:
   - voice_id: from channel
   - text: concatenated voice lines
   - model: eleven_multilingual_v2 (Thai support)
5. Save mp3 to `/home/hermes/data/voiceovers/<script_id>.mp3`
6. Update scripts.voice_path
7. Reply with file path + duration estimate
8. Send mp3 attachment to Telegram via bot.sendAudio()

Output:
\`\`\`
Voice generated for SC-2026-05-08-001
Duration: ~58s
File: /home/hermes/data/voiceovers/SC-2026-05-08-001.mp3
[mp3 attached]
\`\`\`

Error handling:
- If ElevenLabs returns 429 (rate limit): retry once after 30s, else surface error
- If quota exceeded: alert "ElevenLabs quota หมด — เช็ค billing"
- If voice_id invalid: alert "voice_id ของช่อง <ch> ผิด — แก้ใน context.md"
MD
')
```

- [ ] **Step 2.5: Write `/avatar-render` skill (NEW for AI-avatar pipeline)**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/avatar-render && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/avatar-render/SKILL.md <<MD
---
name: avatar-render
description: Pipeline — voiceover mp3 + HeyGen avatar + Higgsfield b-roll → final mp4 ready to upload
---

# /avatar-render <script_id>

End-to-end pipeline:

1. Fetch script + channel + content_type from DB
2. Verify voice_path exists (if not, auto-call /voiceover first)
3. Determine render mode by content_type:
   - **review/tip**: Foreground = HeyGen avatar talking-head (50-60% screen) + product/tip b-roll
   - **story**: Foreground = HeyGen avatar full-body + slice-of-life b-roll
   - **trend**: Foreground = HeyGen avatar + trending audio overlay

4. Call HeyGen API:
   - input_audio: voice_path (mp3)
   - avatar_id: <HEYGEN_AVATAR_ID> (from settings, owner-trained)
   - output_format: mp4 (1080×1920 vertical)

5. Call Higgsfield API for b-roll matching script content (5-10 sec clips):
   - For review: product close-up + before/after
   - For tip: scenes matching each tip
   - For story: contextual scenes
   - Output: b-roll mp4 segments

6. (Optional) If hedra_enabled=true: pass HeyGen output through Hedra for tighter lip sync

7. Concatenate via ffmpeg:
   \`\`\`
   ffmpeg -i avatar.mp4 -i broll1.mp4 -i broll2.mp4 \\
     -filter_complex "[0:v]scale=1080:1920[v0]; ..." \\
     -c:a aac -ar 44100 final.mp4
   \`\`\`

8. Save to /home/hermes/data/renders/<script_id>.mp4
9. Send mp4 attachment to Telegram for owner approval
10. Insert into videos table with status=pending_upload, content_type per script

Cost estimate (per render):
- HeyGen Starter: ~3-5 credits/render = ~30-50 sec audio
- Higgsfield: existing quota (no incremental cost)
- Total ~10-15 renders/wk fits within $29 HeyGen Starter plan

Output:
\`\`\`
Render complete: SC-2026-05-08-001
Type: review (home channel)
Duration: 58s
File: /home/hermes/data/renders/SC-2026-05-08-001.mp4
[mp4 attached to Telegram]

Approve upload? ตอบ yes/no/regen
\`\`\`

Error handling:
- HeyGen quota exceeded: alert, suggest upgrade or wait reset
- Avatar render fails (face occlusion in source photos): suggest re-train with new photos
- Higgsfield b-roll fails: fall back to stock b-roll
- ffmpeg merge fails: log + alert, don't crash agent
MD
')
```

- [ ] **Step 3: Write `/check-claims` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/check-claims && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/check-claims/SKILL.md <<MD
---
name: check-claims
description: Run script through TikTok Community Guidelines + Thai FDA cosmetic-claim rules
---

# /check-claims <script_id> | <script_text>

Trigger: `/check-claims SC-XXX` or auto-called from /script.

Rules to enforce:

## TikTok Community Guidelines (high-risk)
- No "best" / "cheapest" / "only" / "ดีที่สุด" / "ถูกที่สุด"
- No miracle claims ("รักษา", "หายขาด", "100%")
- No medical advice
- No fake urgency ("เหลือ 1 ชิ้น" without proof)
- No celebrity comparison without permission

## Thai FDA / cosmetic claims
- No "หาย", "รักษา", "บำบัด" for cosmetic products
- No specific health benefit claims without registration
- No "antibacterial" without test result reference
- No medical device claim

## Profanity / sensitive content
- No slang flagging
- No explicit demographic targeting

Output:
\`\`\`
Script SC-XXX compliance: PASS / FAIL

Issues found:
- Line 3 "ดีที่สุดในตลาด" → suggest "ตัวที่เราเจอน่าสนใจ"
- Line 7 "ใช้ครั้งเดียวเห็นผล" → suggest "ใช้ไปสักพักจะรู้สึกชัด"

Replace + re-check? (y/n)
\`\`\`

If PASS: update scripts.compliance_passed=1
If FAIL: update scripts.compliance_passed=0 + scripts.compliance_issues=<json>
MD
')
```

---

## Task 8: Skills batch 3 — Operations (`/calendar`, `/content-plan`, `/dashboard`, `/winners`, `/spark`, `/budget`, `/inbox`)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/skills/<name>/SKILL.md` × 7

- [ ] **Step 1: Write `/calendar` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/calendar && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/calendar/SKILL.md <<MD
---
name: calendar
description: Show TH event calendar with hook templates for next 30 days
---

# /calendar

Trigger: `/calendar` or "มีอะไรใกล้ๆ"

Steps:
1. Query: SELECT * FROM events WHERE date BETWEEN DATE("now") AND DATE("now", "+30 days") ORDER BY date
2. Group by category (payday, cultural, holiday)
3. For each event suggest hook angle from `hook_template` field
4. Output table:

\`\`\`
30 วันข้างหน้า
2026-05-25 | เงินเดือน | "เงินเดือนเข้าเเล้วใช่ไหม? อันนี้ดี + ราคาเบาๆ"
2026-05-30 | เงินเดือน | (ใช้ template)
2026-06-09 | วันเด็ก | "ของเด็กๆ ใช้ได้นานๆ" (home only)
\`\`\`
MD
')
```

- [ ] **Step 1.5: Write `/content-plan` skill (NEW for content mix)**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/content-plan && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/content-plan/SKILL.md <<MD
---
name: content-plan
description: Generate weekly content plan with 60/20/10/10 mix per channel
---

# /content-plan [home|gadget] [--weeks 1|2]

Trigger: `/content-plan` or `/content-plan home --weeks 2`.

## Logic

1. Read content mix targets from settings:
   - review_pct=60, tip_pct=20, story_pct=10, trend_pct=10

2. For weekly target of 8 videos/channel:
   - 5 reviews
   - 2 tips
   - 1 story OR trend (alternate weeks)

3. Pull ideas:
   - **Reviews**: top 5 from /products (already-running pipeline)
   - **Tips**: brainstorm 2 niche-relevant tips/hacks (from sub-niches in context.md)
   - **Story**: 1 personal-angle (e.g., "วันที่เจอกลัวเดน", "ตื่นเช้าทำอาหาร") — owner-relatable
   - **Trend**: scan 24-hr TikTok trending audio + suggest niche adapt

4. Output weekly calendar:

\`\`\`
📅 Week of 2026-05-12 — channel: home (target 8 vids)

จันทร์ 19:00 [review] ที่ปอกกระเทียม 199฿ — /products picked
อังคาร 11:00 [tip] "5 ทริคล้างจานเร็วขึ้น 2 เท่า"
อังคาร 19:00 [review] sticky cleaner roll 149฿
พุธ 11:00 [review] แม่เหล็กติดผนัง 99฿
พฤ 19:00 [story] "วันที่หาของในห้องครัวไม่เจอ"
ศุกร์ 11:00 [review] ที่หั่นผัก 299฿
ศุกร์ 19:00 [trend] adapt "5 things in my X" trend → ครัวฉัน
ส 11:00 [tip] "3 ของในครัวที่หลายคนทิ้งทั้งที่ใช้ได้"

Mix actual: review 50%, tip 25%, story 12.5%, trend 12.5% — slightly review-low
ปรับ: เพิ่ม 1 review ในวันอาทิตย์ → 6 review = 60% target ✓
\`\`\`

5. Track delivered vs planned:
   - Compare against videos.content_type counts last 7 days
   - Flag if any type < target by > 30%

6. Reply with action items:

\`\`\`
จุดควรปรับ:
- review = 50% (target 60%) → ขาด 1 vid
- trend = 0% last week (target 10%) → grab today\\'s trending audio
\`\`\`
MD
')
```

- [ ] **Step 2: Write `/dashboard` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/dashboard && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/dashboard/SKILL.md <<MD
---
name: dashboard
description: Show yesterday + last-7-day performance summary
---

# /dashboard [--channel home|gadget] [--period day|week|month]

Default: yesterday, both channels.

Queries:
1. Per-channel: views, ctr, cart_clicks, sales count, gmv, commission, clawback
2. Aggregate: total revenue, ROAS (if any ad spend)
3. Top 3 videos by commission

Output:
\`\`\`
📊 เมื่อวาน 2026-05-08

[home] @<HOME_HANDLE>
- Views: 12,450
- Cart clicks: 580 (CTR 4.7%)
- Sales: 32 → 8,400฿ GMV → 1,120฿ commission
- ROAS: 2.1x (ad spend 540฿)

[gadget] @<GADGET_HANDLE>
- Views: 4,200
- Cart clicks: 110 (CTR 2.6%)
- Sales: 8 → 1,900฿ GMV → 220฿ commission
- ROAS: 0.8x ⚠️

Total commission: 1,340฿
Total ad spend: 1,200฿
Net: +140฿

Top videos:
1. <video_id> (home) → 540฿ commission
2. <video_id> (home) → 320฿ commission
3. <video_id> (gadget) → 110฿ commission
\`\`\`
MD
')
```

- [ ] **Step 3: Write `/winners` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/winners && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/winners/SKILL.md <<MD
---
name: winners
description: List videos qualifying for Spark Ads boost (organic-proven)
---

# /winners

Criteria:
- ctr_pct > 5
- completion_pct > 30
- cart_clicks > 50
- posted_at > 24hr ago AND < 7 days ago
- status = "live" (not already boosted)

Output:
\`\`\`
🏆 Spark Ads candidates (4 found)

1. <video_id> | home | 8.2% CTR, 35% completion, 230 cart clicks
   → suggest 800฿/day × 5 days
2. <video_id> | home | 6.1% CTR, 31% completion, 180 cart clicks
   → suggest 500฿/day × 3 days
3. <video_id> | gadget | 7.5% CTR, 33% completion, 95 cart clicks
   → suggest 500฿/day × 3 days
4. <video_id> | gadget | 5.9% CTR, 30% completion, 60 cart clicks
   → marginal — wait 24hr

Type "/spark <video_id>" to boost
\`\`\`
MD
')
```

- [ ] **Step 4: Write `/spark` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/spark && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/spark/SKILL.md <<MD
---
name: spark
description: Recommend Spark Ads boost decision + confirm via Telegram
---

# /spark <video_id>

Steps:
1. Fetch video metrics from DB
2. Check eligibility (organic threshold passed)
3. Determine tier:
   - Top 1% (CTR>10, completion>40): 2-3k/day × 7d
   - Top 5% (CTR>7): 800-1.5k/day × 5d
   - Top 10% (CTR>5): 500-800/day × 3d
4. Calculate ROAS estimate using current commission/ad-spend ratio
5. Present recommendation + ask "ยืนยัน boost? ตอบ yes/no/ปรับ <amount>"
6. On yes: insert into ad_campaigns with status=active, started_at=now
7. **For ads > 500฿/day**: REQUIRE explicit "yes" confirmation (never auto-boost)
8. Reply: "Boost queued. Update Spark Ads via TikTok Ads Manager:
   https://ads.tiktok.com/i18n/login → boost video <id> at <budget>/day for <days> days"

Output:
\`\`\`
🚀 Spark Ads recommendation: <video_id>
Channel: home
Current organic: 8.2% CTR, 35% completion, 230 carts in 36hr
Tier: Top 1%
Suggested: 2,000฿/day × 7d = 14,000฿ total
Estimated ROAS: 1.8-2.5x
Risk: medium (high spend)

ยืนยัน boost? ตอบ yes / no / ปรับ <amount>
\`\`\`
MD
')
```

- [ ] **Step 5: Write `/budget` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/budget && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/budget/SKILL.md <<MD
---
name: budget
description: Show current spend allocation + recommend rebalance
---

# /budget

Steps:
1. Query last-30-day spend + revenue per channel
2. Compute current ROAS per channel
3. Compare against monthly budget setting
4. If ROAS gap > 1.0 between channels: recommend rebalance

Output:
\`\`\`
💰 Budget status (last 30d)

Setting: 50,000฿/mo total (25k/ch)

Channel: home
- Spend: 12,400฿ (49% of allocation)
- Revenue: 28,500฿
- ROAS: 2.30x ✓

Channel: gadget
- Spend: 8,800฿ (35%)
- Revenue: 6,200฿
- ROAS: 0.70x ⚠️

Recommendation:
- Shift 5,000฿ from gadget → home next month
- Pause low-performer gadget creatives, refresh top 2 only
- Continue scaling home (consider 30k allocation)

ยืนยันปรับ allocation? y/n
\`\`\`
MD
')
```

- [ ] **Step 6: Write `/inbox` skill**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/skills/inbox && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/skills/inbox/SKILL.md <<MD
---
name: inbox
description: Summarize TikTok DMs + comments, suggest replies
---

# /inbox

**Note:** TikTok has no public API for DMs/comments. Owner pastes recent messages
into Telegram chat for the agent to summarize.

Steps:
1. Owner pastes 1-50 messages (DMs + comments)
2. Categorize: question / complaint / spam / order issue / partnership inquiry
3. Suggest reply per category:
   - Order issue → "ลูกค้ารัก, รบกวนทักหา TikTok Shop seller โดยตรงเลยค่ะ + share order ID"
   - Partnership → "ขอบคุณค่ะ, ลองส่ง brief + budget มาที่ <email>"
   - Spam → "ignore"
   - Question → suggest concise answer

Output:
\`\`\`
📬 Inbox summary (12 messages)

ออเดอร์ปัญหา (3) — แนะนำตอบ: "รบกวนแจ้ง order# มาให้แม่ค้าเลยค่ะ"
คำถามสินค้า (5) — replies suggested individually
สแปม (2) — ignore
ความร่วมมือ (2) — แนะนำตอบ: "ส่ง brief มาที่ partner@example.com"

ตอบ "/inbox detail" เพื่อดู full reply suggestions
\`\`\`
MD
')
```

---

## Task 9: Cron jobs (5 scheduled)

**Files:**
- Create on VM: `/home/hermes/.hermes/profiles/affiliate/cron/<name>.cron` × 5

- [ ] **Step 1: Trending digest (09:00 daily)**

```bash
SSH('sudo -u hermes mkdir -p /home/hermes/.hermes/profiles/affiliate/cron && \
sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/cron/morning-digest.cron <<CRON
schedule: "0 9 * * *"
timezone: "Asia/Bangkok"
prompt: |
  รัน /products สำหรับทั้ง 2 channels (home + gadget)
  ส่งสรุปไป Telegram เป็น 2 sections
  ถ้าเจอ event ใน /calendar 7 วันข้างหน้า — ใส่ tip ท้าย
CRON
')
```

- [ ] **Step 2: Post nudge (12:00 daily)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/cron/post-nudge.cron <<CRON
schedule: "0 12 * * *"
timezone: "Asia/Bangkok"
prompt: |
  เช็คตาราง videos: ช่องไหนไม่มี post ใน 24 ชม.ล่าสุด ?
  ส่งเตือน Telegram: "ช่อง <ch> ยังไม่ได้ post วันนี้ — มี script SC-XXX พร้อมใช้ <list>"
  ถ้าไม่มี script ค้าง: "/script ก่อน หรือ /products ใหม่"
CRON
')
```

- [ ] **Step 3: Yesterday performance (18:00 daily)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/cron/evening-summary.cron <<CRON
schedule: "0 18 * * *"
timezone: "Asia/Bangkok"
prompt: |
  รัน /dashboard --period day สำหรับเมื่อวาน
  ถ้ามี winner วันนี้ — เพิ่มท้าย "/winners — มี <n> ตัวพร้อม Spark Ads"
  ถ้ามี clawback — alert
CRON
')
```

- [ ] **Step 4: Weekly review (อาทิตย์ 20:00)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/cron/weekly-review.cron <<CRON
schedule: "0 20 * * 0"
timezone: "Asia/Bangkok"
prompt: |
  รัน /dashboard --period week
  รัน /budget — recommend rebalance
  รัน /calendar 7 วันข้างหน้า
  สรุป: P&L รอบสัปดาห์, winners, losers, allocation suggestion, next week themes
CRON
')
```

- [ ] **Step 5: Monthly reconciliation (1st 09:00)**

```bash
SSH('sudo -u hermes tee /home/hermes/.hermes/profiles/affiliate/cron/monthly-recon.cron <<CRON
schedule: "0 9 1 * *"
timezone: "Asia/Bangkok"
prompt: |
  รัน /dashboard --period month
  Reconcile: TikTok Shop payout vs DB.revenue (status=paid)
  ส่ง alert ถ้า variance > 5%
  แสดง clawback report by channel + product type
  ROAS by channel for month
  Monthly burn vs budget
CRON
')
```

- [ ] **Step 6: Register all crons**

```bash
SSH('sudo -u hermes /home/hermes/.local/bin/hermes profile use affiliate && \
sudo -u hermes /home/hermes/.local/bin/hermes cron register --all')
```

Expected: 5 crons registered. Verify:

```bash
SSH('sudo -u hermes /home/hermes/.local/bin/hermes cron list')
```
Expected: shows all 5 with timezone Asia/Bangkok.

---

## Task 10: TikTok Shop CSV importer

**Files:**
- Create on VM: `/home/hermes/data/affiliate-import.sh`

- [ ] **Step 1: Write CSV importer script**

```bash
SSH('sudo -u hermes tee /home/hermes/data/affiliate-import.sh <<BASH
#!/bin/bash
# Import TikTok Shop affiliate orders CSV into affiliate.db
# Usage: ./affiliate-import.sh <csv_path> <channel_id>
#
# CSV expected columns (TikTok Shop Affiliate Center export):
#   Order ID, Product Name, Order Time, Delivery Time, GMV, Commission,
#   Status (Pending/Settled/Cancelled), Video URL
set -euo pipefail

CSV="\$1"
CHANNEL="\$2"
DB=/home/hermes/data/affiliate.db

if [ ! -f "\$CSV" ]; then
  echo "CSV not found: \$CSV" >&2
  exit 1
fi

# Parse + insert (skip header)
tail -n +2 "\$CSV" | while IFS=, read -r order_id product_name order_time delivery_time gmv commission status video_url; do
  # Map status: Pending → pending, Settled → paid, Cancelled → clawback
  case "\$status" in
    Pending) db_status=pending ;;
    Settled) db_status=paid ;;
    Cancelled|Refunded) db_status=clawback ;;
    *) db_status=pending ;;
  esac

  # Extract video ID from URL (last path segment)
  video_id=\$(echo "\$video_url" | sed "s|.*/||")

  sqlite3 "\$DB" <<SQL
INSERT OR IGNORE INTO revenue (id, channel_id, order_id, gmv_thb, commission_thb, status, ordered_at, delivered_at, video_id)
VALUES (
  "rev_" || lower(hex(randomblob(8))),
  "\$CHANNEL",
  "\$order_id",
  \$gmv,
  \$commission,
  "\$db_status",
  "\$order_time",
  "\$delivery_time",
  (SELECT id FROM videos WHERE tiktok_video_id = "\$video_id" LIMIT 1)
);
SQL
done

# Summary
sqlite3 "\$DB" "SELECT COUNT(*), SUM(commission_thb) FROM revenue WHERE channel_id = \"\$CHANNEL\";"
BASH
sudo -u hermes chmod +x /home/hermes/data/affiliate-import.sh')
```

- [ ] **Step 2: Test importer with sample CSV**

```bash
SSH('cat > /tmp/sample.csv <<CSV
Order ID,Product Name,Order Time,Delivery Time,GMV,Commission,Status,Video URL
ORD001,Test Product,2026-05-08 10:00,2026-05-09 14:00,299,30,Pending,https://tiktok.com/v/1234567890
CSV
sudo -u hermes /home/hermes/data/affiliate-import.sh /tmp/sample.csv home && \
sudo -u hermes sqlite3 /home/hermes/data/affiliate.db "SELECT order_id, gmv_thb, commission_thb FROM revenue WHERE order_id = \"ORD001\";"')
```

Expected: row inserted.

- [ ] **Step 3: Cleanup test row**

```bash
SSH('sudo -u hermes sqlite3 /home/hermes/data/affiliate.db "DELETE FROM revenue WHERE order_id = \"ORD001\";"')
```

---

## Task 11: Telegram bot menu configuration

**Files:**
- Update: `@BotFather` bot commands (no local file)

- [ ] **Step 1: Set bot command menu via BotFather**

Owner does this manually in Telegram:

> Open @BotFather → /mybots → @affiliate_secretary_bot → Edit Bot → Edit Commands
>
> Paste:
> ```
> products - หาสินค้าน่าปักวันนี้
> content_plan - แผน content รายสัปดาห์ (60/20/10/10)
> script - เขียน script ขายสินค้า (Hook→Pain→Sol→Result→CTA)
> avatar_script - เขียน script ไม่เกี่ยวสินค้า (tip/story/trend)
> voiceover - อัด voice ผ่าน ElevenLabs
> avatar_render - render คลิป HeyGen avatar + b-roll
> check_impulse - คะแนน impulse-fit ของสินค้า
> check_claims - ตรวจ compliance (TikTok+อย.)
> calendar - TH event 30 วันข้างหน้า
> dashboard - performance เมื่อวาน + 7 วัน
> winners - vid พร้อม Spark Ads
> spark - boost vid + ขอ confirm
> budget - allocation + rebalance
> inbox - สรุป DM/comment
> ```

- [ ] **Step 2: Verify menu shows up in Telegram**

Owner: open chat with @affiliate_secretary_bot → type `/` → 11 commands appear.

---

## Task 12: Service start + smoke test

- [ ] **Step 1: Start affiliate gateway**

```bash
SSH('USER_SYSTEMD start hermes-gateway-affiliate && sleep 3 && USER_SYSTEMD is-active hermes-gateway-affiliate')
```

Expected: `active`

- [ ] **Step 2: Verify all 6 profiles still healthy**

```bash
SSH('USER_SYSTEMD is-active hermes-gateway-personal hermes-gateway-golf hermes-gateway-bc-cmo hermes-gateway-bc-cfo hermes-gateway-fon hermes-gateway-affiliate')
```

Expected: 6 lines of `active`

- [ ] **Step 3: Smoke test — Telegram → /calendar**

Owner: send `/calendar` to @affiliate_secretary_bot

Expected: bot replies with TH event table for next 30 days (events seeded in Task 5).

- [ ] **Step 4: Smoke test — Telegram → /products home**

Owner: send `/products home`

Expected: bot replies asking owner to provide TikTok Affiliate Center product list (per skill design — no public API).

- [ ] **Step 5: Smoke test — Telegram → /script test**

Owner: send "เขียน script ทดสอบสินค้า แปรงล้างจาน 199฿ ช่อง home"

Expected: bot generates 60s script in Hook→Pain→Solution→Result→CTA format.

- [ ] **Step 6: Smoke test — Telegram → /voiceover SC-XXX**

Owner: send `/voiceover <id_from_step_5>`

Expected: bot replies with mp3 attachment, ~50-60s duration, Thai voice (home channel persona).

- [ ] **Step 7: Smoke test — cron simulation**

```bash
SSH('sudo -u hermes /home/hermes/.local/bin/hermes profile use affiliate && \
sudo -u hermes /home/hermes/.local/bin/hermes cron run morning-digest --dry-run')
```

Expected: dry-run output shows what would be sent at 09:00.

---

## Task 13: Documentation + runbook

**Files:**
- Create: `/Users/iamnaii/Desktop/App/HERMES/docs/affiliate-runbook.md`
- Create: `/Users/iamnaii/Desktop/App/BESTCHOICE/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_hermes_affiliate_profile_2026_05_08.md` (auto-memory)

- [ ] **Step 1: Write runbook**

```bash
cat > /Users/iamnaii/Desktop/App/HERMES/docs/affiliate-runbook.md <<'MD'
# Affiliate Profile — Operations Runbook

## Daily routine (~10-15 min)
1. Read 09:00 trending digest (Telegram)
2. Check 18:00 yesterday's performance
3. Approve products/scripts as agent suggests
4. Manually upload videos to TikTok during day

## Weekly routine (Sunday, ~30 min)
1. Read 20:00 weekly review
2. Approve/reject budget rebalance
3. Plan next week themes from /calendar

## Monthly routine (1st of month, ~1 hr)
1. Export TikTok Shop affiliate orders CSV
2. Run /home/hermes/data/affiliate-import.sh <csv> <channel>
3. Review reconciliation alert
4. Decide next month budget

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot not replying | `USER_SYSTEMD restart hermes-gateway-affiliate` |
| ElevenLabs quota exceeded | Upgrade tier in dashboard or wait reset |
| Cron not firing | `hermes cron list` → verify schedule |
| TikTok video metrics stale | Run manual sync (CSV import) |
| Clawback rate spike | /dashboard --period month + investigate top return reasons |

## Stop-loss escalation

If 2 consecutive weeks both channels ROAS < 0.7:
1. Pause all Spark Ads
2. Owner reviews creative pattern
3. Refresh 5 new creatives per channel
4. Re-test for 2 weeks
5. If still bad → consider niche pivot (Section 5 Phase 5 of spec)

## Revenue cycle (TikTok Shop)
- Order → 30-day return window
- Settle D+15 (Express) or D+31 (Standard)
- Clawback: pre-payout = lose, post-payout = keep
- Payout to bank account: Via TikTok Shop seller center

## Privacy boundaries
- This profile has NO access to BESTCHOICE business.db
- This profile has NO access to personal.db
- All affiliate data lives in /home/hermes/data/affiliate.db only
MD
```

- [ ] **Step 2: Add memory entry for future Claude sessions**

```bash
mkdir -p /Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory
cat > /Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_hermes_affiliate_profile_2026_05_08.md <<'MD'
---
name: Hermes affiliate profile (6th agent — TikTok Shop side hustle)
description: 6th Hermes profile for owner's TikTok Shop affiliate side business. 2 channels (home/gadget), faceless impulse-buy ≤499฿, 50k/mo ad budget, Telegram @affiliate_secretary_bot. Strict isolation — no business.db or personal.db access. Provisioned 2026-05-08.
type: project
---
**Provisioned 2026-05-08** as 6th profile on existing Hermes VM (bestchoice-hermes/hermes-vm).

## Setup
- Profile dir: /home/hermes/.hermes/profiles/affiliate/
- Telegram bot: @affiliate_secretary_bot (allow-list owner only)
- Service: hermes-gateway-affiliate.service (port 8647)
- Provider: openai-codex primary, claude-sonnet-4-6 fallback
- Persona: junior performance marketer, "เรา/ครับ" tone neutral

## Channels (2)
- home (Home/Kitchen) — @<HOME_HANDLE>, voice: warm female, posting 11:00/19:00
- gadget (Phone/Gadget) — @<GADGET_HANDLE>, voice: neutral mid-tone, posting 12:00/20:00/22:00

## Data access
- /home/hermes/data/affiliate.db (rw) — 8 tables: channels, products, scripts, videos, revenue, ad_campaigns, events, settings
- ElevenLabs API — Creator tier $22/mo, 2 Thai voices
- INTENTIONALLY NOT shared: business.db, personal.db (clean isolation from BESTCHOICE)
- google-calendar reused, Higgsfield reused via symlink

## Skills (11 commands)
products, check-impulse, script, voiceover, check-claims, calendar, dashboard, winners, spark, budget, inbox

## Cron jobs (5, all Asia/Bangkok)
- 09:00 morning-digest (trending products)
- 12:00 post-nudge
- 18:00 evening-summary
- Sun 20:00 weekly-review
- 1st 09:00 monthly-recon

## Stop-loss rules
- Channel ROAS < 0.7 for 2 wks → pause + alert
- Monthly burn projected > 80k → halt all ads
- Clawback rate > 15% → investigate niche
- TikTok account ban signal → escalate immediately

## How to apply
- Owner asks "เลขา affiliate ทำงานไหม" → check `systemctl --user is-active hermes-gateway-affiliate`
- Spec: docs/superpowers/specs/2026-05-08-affiliate-agent-tiktok-shop-design.md
- Plan: docs/superpowers/plans/2026-05-08-affiliate-agent-tiktok-shop.md

## Privacy boundary
- Agent refuses queries that would touch BESTCHOICE business.db (allowed in fon, NOT here)
- Allow-list strict to owner Telegram ID
MD

# Update MEMORY.md index
echo "- [Project: Hermes affiliate profile (6th agent — TikTok Shop)](project_hermes_affiliate_profile_2026_05_08.md) — 2026-05-08, 2-channel (home+gadget) TikTok Shop affiliate side business, faceless impulse <=499฿, 50k/mo budget, strict isolation from BESTCHOICE biz/personal.db" >> /Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/MEMORY.md
```

- [ ] **Step 3: Final commit**

```bash
cd /Users/iamnaii/Desktop/App/HERMES
git add docs/affiliate-runbook.md
git commit -m "docs(affiliate): operations runbook for 6th profile"

cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add docs/superpowers/plans/2026-05-08-affiliate-agent-tiktok-shop.md
git commit -m "docs: implementation plan for affiliate agent (6 phases, 13 tasks)"
```

---

## Phase 2 Onboarding (post-implementation, owner-driven)

These are NOT plan tasks — they are owner activities after Tasks 1-13 complete:

| Week | Activity | Time |
|---|---|---|
| 3 | Use `/products home` daily, approve 5/day, batch produce 5 vids/day | ~12 hr/wk |
| 3-4 | Post 3-4/wk per channel, monitor /dashboard | ~10 hr/wk |
| 5 | Identify 2-3 organic winners, run `/spark` | ~10 hr/wk |
| 6+ | Daily ads adjustment, weekly /budget review | ~8-10 hr/wk |
| 12 | Phase 5 decision (scale/maintain/pivot) | full review |

---

## Self-Review Notes

(Plan author check before handoff)

✅ **Spec coverage:** All 12 sections of spec mapped to tasks. Section 11 defaults applied in spec edit before plan.
✅ **No placeholders:** All `<TOKEN>` strings are explicit substitutions from Task 1 fields.
✅ **Type consistency:** DB column names match across SQL (Task 5) + skills (Tasks 6-8).
✅ **Test pattern:** Smoke tests in Task 12 cover end-to-end (calendar, products, script, voiceover).
✅ **Owner gates:** Task 1 (prerequisites) + Task 11 (BotFather menu) are explicit human steps.
✅ **Rollback:** Each task is additive (new files); rollback = remove profile dir + service.

---

**Plan complete.** Spec at `docs/superpowers/specs/2026-05-08-affiliate-agent-tiktok-shop-design.md`. Plan at `docs/superpowers/plans/2026-05-08-affiliate-agent-tiktok-shop.md`.
