# Affiliate Marketing Agent — TikTok Shop (ปักตะกร้า) Side Hustle

**Date:** 2026-05-08
**Owner:** akenarin.ak@gmail.com
**Status:** Design — pending approval
**Type:** Standalone side-business (NOT related to BESTCHOICE)

---

## 1. Strategy Summary

โปรเจคนี้เป็น **second job** สร้างรายได้เสริมจาก TikTok Shop Affiliate (ปักตะกร้า) แบบ
**AI-avatar (หน้า owner สร้างโดย AI) + impulse-buy products + content mix 60/20/10/10**
บน 2 channels พร้อมกัน — โดยมี Hermes profile ตัวที่ 6 (Telegram bot + cron + DB)
เป็น operations agent ช่วย research, script, content planning, avatar render, monitor,
performance dashboard

### Core decisions (locked)

| Setting | Value | Rationale |
|---|---|---|
| Niche channels | Home/Kitchen + Phone/Gadget | Audience ไม่ทับ, demo ง่าย, owner รู้ phone gadget อยู่แล้ว |
| Content style | **AI-avatar** (owner's face cloned by HeyGen/Higgsfield + AI voice + AI b-roll) | Owner's face = trust building; AI gen = scale + privacy still tooling-controlled |
| Content mix | **60% review / 20% tips / 10% behind-scenes / 10% trends** | TikTok algorithm 2026 penalizes pure-sales channels; growth + revenue balance |
| Price ceiling | ≤ 499 ฿ (max 799 ฿) | Impulse buy threshold |
| Time budget | 8-12 hr/wk | Sweet spot solo + agent |
| Ad budget | 50k/เดือน (25k/ch) | Phased — start week 5 |
| Setup ownership | Claude builds agent, owner registers TikTok Shop + 2 TikTok accounts + 10-20 reference photos | Split by ID/legal requirement |
| Voice strategy | **ElevenLabs stock Thai voices** (2 voices, no clone) | Cheaper start; defer voice cloning to Phase 4 if winners |
| Privacy stance | **Real face on public TikTok** (owner accepts BESTCHOICE customer overlap risk) | Q3=A locked; bio must NOT link back to BESTCHOICE |
| Architecture | Hermes profile #6 (multi-channel-aware + content-type-aware) | Reuse existing VM + pattern |

### Why TikTok Shop Affiliate (not other affiliate models)

- TH GMV top-3 in SEA — live commerce หนัก, customers buy fast
- Beauty/Health/Personal Care = #1 GMV category 2026
- **No 1,000-follower wait** — register via Shop Seller Center → Marketing Account → ปักตะกร้าได้ทันที
- Commission 5-15% standard, 20-30% LIVE, payable D+15 to D+31
- AI avatar + ElevenLabs + CapCut = production batch 10-12 vids/wk realistic at 8-12 hr

### Why AI-avatar + content mix (not pure-faceless or pure-product)

- **AI-avatar > faceless** for trust: viewers connect with a face, conversion rate higher 2-3x vs pure-product POV
- **AI-avatar > real-camera** for scale: no studio, no light setup, no re-shoot — generate on demand from script
- **Owner's face as anchor + AI body/scene**: HeyGen/Higgsfield generate b-roll while owner's face does the talking
- **Content mix 60/20/10/10**: TikTok 2026 algorithm penalizes channels >70% sponsored — non-sales content is the price of algo reach
- Impulse products (≤499฿) = visual = sale, **but face-on still helps** for review credibility
- Return rate ต่ำ → clawback กิน revenue น้อย

---

## 2. Niche Definition + Product Criteria

### Channel 1: **Home/Kitchen Gadgets**

| Field | Value |
|---|---|
| Audience | หญิง 25-50, แม่บ้าน, working women, cooking enthusiasts |
| Voice persona | ผู้หญิงเสียงนุ่ม "เพื่อนแชร์ของถูก" |
| Hook style | "เคยเหนื่อยทำ X ไหม?" / "รู้ไหมว่ามีของแบบนี้?" |
| Posting time | 11:00, 19:00 (Asia/Bangkok) |
| Sub-niches | Cleaning gadgets, kitchen tools, organizing, home repair, pest control |
| Sample products | ที่ปอกกระเทียม, ที่หั่นผักหลายแบบ, แปรงล้างจาน silicone, sticky cleaner roll, magnetic hooks, drawer dividers |
| Price range | 99-399฿ |
| Commission expected | 8-15% |

### Channel 2: **Phone Accessories / Gadget**

| Field | Value |
|---|---|
| Audience | ทุกเพศ 18-40, tech-curious, students, office workers |
| Voice persona | กลางๆ neutral "นักรีวิวสายเทค" |
| Hook style | "รู้ไหมว่าโทรศัพท์เก่าก็..." / "อันนี้แก้ปัญหาทุกคนเคยเจอ" |
| Posting time | 12:00, 20:00, 22:00 |
| Sub-niches | Phone holders/stands, cable organizers, screen cleaners, mini speakers, USB gadgets, LED, mini fans, charging accessories |
| Sample products | Magnetic phone holder, retractable cable, UV phone cleaner, mini phone vacuum, ring grip, phone cooling fan, mini Bluetooth speaker, USB-C dongle |
| Price range | 99-399฿ |
| Commission expected | 5-12% |

### Product Selection Rules (impulse filter)

ก่อนนำสินค้าเข้า workflow ต้องผ่าน 5 เกณฑ์:

1. **Price ≤ 499฿** (preferred 99-299฿) — impulse threshold
2. **Demo-able ใน 10 วินาที** — visual = understanding, ไม่ต้องอ่าน spec
3. **Pain → Solution clarity** — ปัญหาเห็นชัดในวิดีโอใน 3 วิแรก
4. **Return rate < 5%** — check seller history หรือ category average
5. **Commission ≥ 5%** + commission/sale ≥ 20฿ — ไม่งั้น ROAS หาก scale ไม่ได้

### Excluded categories (ห้าม)

| Category | เหตุผล |
|---|---|
| Skincare/cosmetics | ต้องเชื่อ brand, ผลช้า 2-4 wk, return ผิวแพ้ |
| Supplements/drinks | อย. claim risk, slow result, trust required |
| Fashion/clothing | Size return เยอะ, ต้องเห็นใส่จริง |
| Electronics > 1,000฿ | เกิน impulse, ต้อง research review |
| Food perishable | Compliance + shipping risk |

---

## 3. Content Workflow (AI-Avatar + Mix)

### Single-video pipeline — 4 content types (target 30-45 min/video at scale)

#### Type 1: Product Review (60% — revenue-direct)

```
[Trending product] → /products picks (agent)
        ↓
[Impulse check]  → /check-impulse (agent)
        ↓
[Script gen]     → /script <product> --channel home (agent, Hook→Pain→Solution→Result→CTA)
        ↓
[Compliance]     → /check-claims (TikTok+อย.)
        ↓
[Voiceover]      → ElevenLabs Thai voice (per channel)
        ↓
[Avatar render]  → /avatar-render → HeyGen talking-head with owner's face + Higgsfield b-roll
        ↓
[Edit]           → CapCut (auto-cap Thai, music, transitions)
        ↓
[Upload]         → TikTok with affiliate cart link
        ↓
[Track]          → DB, agent monitors
```

#### Type 2: Tips/Hacks/Edutainment (20% — algo growth)

```
[Topic idea] → /content-plan suggests (agent picks from trending hashtags + niche keywords)
        ↓
[Script]     → /avatar-script <topic> --type tip (5 tips list, no product CTA)
        ↓
[Avatar render] → owner's face + relevant b-roll
        ↓
[Upload]     → TikTok with niche hashtags (no affiliate link)
```

#### Type 3: Behind-the-scenes / Story (10% — trust)

```
[Story idea] → /avatar-script --type story (e.g., "วันนี้ไปหาของ", "เล่าเรื่องที่เพิ่งเจอ")
        ↓
[Avatar render] → owner's face + slice-of-life b-roll
        ↓
[Upload]
```

#### Type 4: Trends / Reactions (10% — virality)

```
[Trending topic] → /content-plan flags TikTok trend within 48hr
        ↓
[Adapt to niche] → /avatar-script --type trend
        ↓
[Avatar render] → quick turnaround (12-24hr from trend appearing)
        ↓
[Upload]
```

### Content format

#### Type 1 (Product Review, 30-60 sec)

```
[0-3s]   HOOK: AI-avatar (owner) + opening line "เคยเจอแบบนี้ไหม?"
[3-8s]   PAIN: AI-avatar + b-roll showing inefficiency
[8-20s]  SOLUTION: product demo close-up + AI-avatar narration
[20-40s] RESULT: before/after demo + AI-avatar reaction
[40-55s] CTA: AI-avatar "กดตะกร้าด้านล่าง" + urgency hook
[55-60s] LOOP back to hook
```

#### Type 2 (Tips/Hacks, 30-45 sec)

```
[0-3s]   HOOK: AI-avatar "5 ทริค X ที่ไม่มีใครบอก"
[3-40s]  5 tips delivered in punchy clips, AI-avatar transitions
[40-45s] CTA: "กด follow เผื่อ tip ใหม่"
```

#### Type 3 (Behind-the-scenes/Story, 30-60 sec)

```
[0-3s]   HOOK: AI-avatar story opener "วันนี้เจอเรื่อง..."
[3-50s]  Narrative + b-roll of context
[50-60s] Soft CTA: "follow ไว้นะ มีเล่าทุกอาทิตย์"
```

#### Type 4 (Trends, 15-30 sec)

```
Trend audio + AI-avatar adapts to niche angle
```

### Posting cadence per channel

- **Phase 2 (organic test):** 4 videos/wk per channel = ~8 videos/wk total (mix: ~5 review, 2 tips, 1 trend/story)
- **Phase 3-4 (ads scale):** maintain 4/wk + Spark Ads boost on winners; mix preserved 60/20/10/10
- **Phase 5+:** scale winners; non-product content stays 40% min

### Tooling stack

| Tool | Purpose | Cost |
|---|---|---|
| ChatGPT/Claude API | Script generation | ~500-2,000฿/mo |
| **HeyGen Starter** | AI-avatar talking-head from owner's photos | **$29/mo (~1,000฿)** |
| **Hedra Pro** (optional) | Face-to-video lip sync | $15-30/mo (~500-1,000฿) |
| **Higgsfield** (existing) | Full-scene AI gen with face consistency | reuse owner's account |
| ElevenLabs Creator | Thai TTS (2 stock voices) | $22/mo (~750฿) |
| CapCut Pro | Edit + auto-cap Thai | $7.99/mo (~270฿) |
| TikTok Affiliate Center | Product picks (manual scrape) | Free |
| **TOTAL tools/mo** | | **~2,500-3,500฿** |

### AI-Avatar setup requirements (one-time)

- **10-20 reference photos** of owner (different angles, expressions, lighting)
  - Front-facing, ¾ profile (left + right), full profile (both sides)
  - Smiling, neutral, talking, eyes-closed mid-blink (Hedra needs)
  - Indoor + outdoor lighting variants
  - Same hairstyle/glasses across all 20 (avatar trains on consistency)
- Upload to HeyGen + Higgsfield → train avatar models
- Avatar model is reused for all videos across both channels (face is consistent, voice differentiates by channel)

---

## 4. Hermes Agent Architecture

### Profile setup

| Field | Value |
|---|---|
| Profile dir | `/home/hermes/.hermes/profiles/affiliate/` |
| Telegram bot | `@affiliate_secretary_bot` (สร้างใหม่ใน BotFather) |
| Allow-list user | Owner Telegram ID เท่านั้น |
| Persona | Junior performance marketer, "เรา/ครับ" tone, neutral |
| Provider | openai-codex primary, claude-sonnet-4-6 fallback |
| Service | `hermes-gateway-affiliate.service` (user systemd) |
| HOME isolation | `<profile>/home/` per existing pattern |

### Telegram commands

| Command | Args | Purpose |
|---|---|---|
| `/products` | `[home\|gadget]` | Top trending products today, filtered by impulse rules |
| `/content-plan` | `[home\|gadget]` | Weekly plan with 60/20/10/10 mix — list ideas across all 4 content types |
| `/script` | `<product_name> --channel <home\|gadget>` | Generate Thai PRODUCT script (Hook→Pain→Solution→Result→CTA) |
| `/avatar-script` | `<topic> --type tip\|story\|trend --channel <ch>` | Generate non-product script (tips/story/trend) |
| `/voiceover` | `<script_id>` | Send script to ElevenLabs → returns mp3 |
| `/avatar-render` | `<script_id>` | Pipeline: voiceover → HeyGen avatar lip sync → output mp4 ready to upload |
| `/check-impulse` | `<product_name>` | Score product fit (price/demo/pain/trust) — pass or reject |
| `/check-claims` | `<script>` | TikTok Guidelines + Thai FDA check on cosmetic/health claims |
| `/calendar` | — | TH event calendar (Songkran, payday 25-30, holidays, school dates) |
| `/dashboard` | `[--channel <ch>]` | Yesterday or week: views, CTR, GMV, commission, clawback, **content-mix actual vs target** |
| `/winners` | — | Videos qualifying for Spark Ads (CTR>5%, completion>30%) |
| `/spark` | `<video_id>` | Recommend Spark Ads boost decision + budget |
| `/budget` | — | Show current spend allocation + recommend rebalance |
| `/inbox` | — | Summarize TikTok DMs, comments, suggest replies |

### Cron jobs (Asia/Bangkok)

| Time | Job | Output |
|---|---|---|
| 09:00 daily | Trending product digest | Telegram: top 5 picks per channel + commission + reason |
| 12:00 daily | Post nudge | If no upload last 24hr per channel → reminder |
| 18:00 daily | Yesterday performance | Aggregate + per-channel: views, sales, commission |
| Sun 20:00 | Weekly review | P&L, winners, losers, ad allocation, next week plan |
| 1st of month | Monthly reconciliation | Payout vs expected, clawback report, ROAS by channel |

### Database schema (`affiliate.db`, SQLite)

```sql
-- Channels (2 rows seeded)
CREATE TABLE channels (
  id TEXT PRIMARY KEY,                   -- 'home' | 'gadget'
  name TEXT NOT NULL,
  audience TEXT,
  voice_id TEXT,                         -- ElevenLabs voice ID
  hook_style TEXT,
  posting_times TEXT,                    -- JSON ["11:00", "19:00"]
  hashtags TEXT,                         -- JSON ["#hometips", ...]
  tiktok_handle TEXT,
  status TEXT DEFAULT 'active'           -- active|paused|killed
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,                   -- TikTok Shop product ID
  channel_id TEXT REFERENCES channels(id),
  name TEXT,
  price_thb DECIMAL(10,2),
  commission_pct DECIMAL(5,2),
  return_rate_pct DECIMAL(5,2),
  impulse_score INT,                     -- 0-100 from /check-impulse
  category TEXT,                         -- sub-niche
  shop_name TEXT,
  affiliate_link TEXT,
  status TEXT DEFAULT 'pending',         -- pending|approved|rejected|active|done
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  notes TEXT
);

CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  channel_id TEXT REFERENCES channels(id),
  hook TEXT,
  body TEXT,
  cta TEXT,
  duration_sec INT,
  voice_path TEXT,                       -- generated mp3 path
  compliance_passed BOOL,
  compliance_issues TEXT,                -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,                   -- internal ID
  tiktok_video_id TEXT UNIQUE,
  channel_id TEXT REFERENCES channels(id),
  script_id TEXT REFERENCES scripts(id),
  product_id TEXT REFERENCES products(id),       -- NULL for non-product content
  content_type TEXT NOT NULL,            -- 'review' | 'tip' | 'story' | 'trend'
  posted_at DATETIME,
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  shares INT DEFAULT 0,
  comments INT DEFAULT 0,
  cart_clicks INT DEFAULT 0,
  ctr_pct DECIMAL(5,2),
  completion_pct DECIMAL(5,2),
  status TEXT DEFAULT 'live',            -- live|spark|paused|deleted
  last_synced_at DATETIME
);

CREATE TABLE revenue (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES channels(id),
  video_id TEXT REFERENCES videos(id),
  order_id TEXT UNIQUE,
  product_id TEXT REFERENCES products(id),
  gmv_thb DECIMAL(10,2),
  commission_thb DECIMAL(10,2),
  status TEXT,                           -- pending|paid|clawback
  ordered_at DATETIME,
  delivered_at DATETIME,
  payout_at DATETIME,
  clawback_at DATETIME,
  notes TEXT
);

CREATE TABLE ad_campaigns (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES channels(id),
  video_id TEXT REFERENCES videos(id),    -- Spark Ads = boost specific video
  spend_thb DECIMAL(10,2),
  attributed_revenue_thb DECIMAL(10,2),
  roas DECIMAL(5,2),
  status TEXT,                            -- active|paused|killed
  started_at DATETIME,
  ended_at DATETIME
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  date DATE,
  name TEXT,                              -- 'Songkran', 'payday', 'Mother Day', 'BTS'
  category TEXT,                          -- 'holiday'|'payday'|'cultural'
  hook_template TEXT,                     -- suggested hook for that event
  applies_to_channels TEXT                -- JSON ["home","gadget"]
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME
);
-- Settings keys: 'monthly_ad_budget', 'kill_threshold_roas', 'scale_threshold_roas',
--               'tiktok_affiliate_email', 'paysolutions_seller_id', etc.
```

### MCP wrappers

- `affiliate-db` — SQLite RW for owner's affiliate data
- `business-db-readonly` — NOT shared (no BESTCHOICE access for this profile — clean isolation)
- `personal-db` — NOT shared
- `elevenlabs-tts` — wrapper for ElevenLabs API
- `tiktok-shop-readonly` — manual data export script (no public TikTok Shop API)
- Reuse pattern from `fon` profile: `export HOME=/home/hermes` in all wrappers

### Privacy + access boundary

- Allow-list: owner Telegram ID เท่านั้น
- ไม่ share business.db หรือ personal.db
- ไม่มี BESTCHOICE data leak — clean separation
- ElevenLabs API key in profile env, ไม่ commit to repo
- TikTok Shop credentials in profile env

---

## 5. 90-Day Phased Roadmap

### Phase 1 — Setup (Week 1-2)

**Owner tasks (offline, ~3-5 hr total):**
- Register TikTok Shop Seller Center (Marketing Account variant)
- สร้าง 2 TikTok accounts: `@<home_handle>`, `@<gadget_handle>`
- ผูก 2 TikTok accounts กับ Shop Seller Center
- สร้าง Telegram bot ใน BotFather → `@affiliate_secretary_bot`
- ส่ง bot token + Shop affiliate ID + TikTok handles → Claude

**Claude tasks (~6-10 hr):**
- Provision Hermes profile #6 on existing VM
- Setup `affiliate.db` schema + seed channels
- Implement Telegram commands (`/products` → `/inbox`)
- Setup cron jobs
- Wire ElevenLabs API
- Seed events table (TH calendar 90 days)
- Test end-to-end: `/products home` → `/script` → `/voiceover` → mp3 received

**Phase 1 success:** Bot live, owner can run `/products home` and get 5 picks

### Phase 2 — Organic Test (Week 3-4)

**Owner tasks (~12-15 hr total):**
- Produce 10 videos per channel = 20 videos total
- Post 3-4/wk per channel = ~7-8/wk total
- Review agent recommendations daily

**Claude tasks (mostly automated):**
- Daily product picks
- Script generation per request
- Track performance per video
- Identify early signals (CTR, completion, cart clicks)

**Phase 2 success:** 20+ videos posted across channels, dataset enough to identify winners

### Phase 3 — Ads Test (Week 5-8)

**Owner tasks (~10 hr/wk):**
- Continue 3-4/wk per channel
- Review weekly performance dashboards
- Approve/reject Spark Ads recommendations

**Claude tasks:**
- Identify winners (CTR>5%, completion>30%, cart-add>2%)
- Recommend Spark Ads boost (budget 500-1500฿/day)
- Track ROAS daily, alert if < 1.0
- Suggest creative refresh after 7-14 days

**Phase 3 success:** ≥1 winner per channel, ROAS data clean

**Stop-loss rule (Week 8 review):**
- ช่องที่ ROAS < 0.7 หลัง 4 สัปดาห์ ads → **kill** (pause posting + ads)
- Redirect งบ + creative effort ไปช่องอื่น

### Phase 4 — Scale Winners (Week 9-12)

**Owner tasks (~8 hr/wk):**
- Produce 5-7 variants per winner product
- Daily 5-10 min ads adjustment review
- Test LIVE selling 1-2 sessions/wk

**Claude tasks:**
- Auto-rebalance budget toward higher-ROAS channels
- Suggest variant angles (new hook, new pain framing)
- Monitor clawback impact on net revenue
- LIVE event prep (script, product list, hook moments)

**Phase 4 success:** Net positive month, ROAS > 1.5 across surviving channels

### Phase 5 — Decision Point (Day 91)

Decision matrix:

| Scenario | Action |
|---|---|
| Net revenue ≥ 50k/mo, ROAS > 2 | Scale aggressive: budget x2, hire freelance editor |
| Net revenue 10-50k/mo, ROAS 1.5-2 | Maintain, optimize, batch produce more |
| Net revenue < 10k/mo, ROAS 1-1.5 | Pivot niche on lagging channel |
| Net revenue negative or flat | Kill all, write post-mortem, revisit in 6mo |

---

## 6. KPIs + Stop-Loss Rules

### Per-video metrics tracked

| Metric | Threshold (winner) | Threshold (kill) |
|---|---|---|
| Views (24hr) | > 5,000 | < 500 |
| CTR (cart clicks/views) | > 5% | < 1% |
| Completion rate | > 30% | < 10% |
| Cart-add rate | > 2% | < 0.3% |

### Per-channel metrics (weekly)

| Metric | Healthy | Warning | Kill |
|---|---|---|---|
| Avg CTR | > 4% | 2-4% | < 2% |
| Avg ROAS (during ads) | > 1.5 | 0.7-1.5 | < 0.7 |
| Avg revenue/wk | > 5k | 1-5k | < 1k |
| Clawback rate | < 8% | 8-15% | > 15% |

### Monthly stop-loss

- ขาดทุน > 80k/mo for 2 months consecutive → halt all ads, return to organic
- Net positive < 0 for 4 consecutive months → kill program
- ROAS portfolio < 1 for 2 months → pivot niche

### Approval gates

- Spark Ads boost > 1,000฿/day → Telegram confirm prompt
- Monthly budget reallocation > 20% → Telegram confirm prompt
- Channel kill decision → Telegram confirm prompt + 24hr cool-off

---

## 7. Budget Allocation Logic

### Initial allocation (50k/mo)

| Channel | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|
| Home | 0 | 25k | rebalance per ROAS |
| Gadget | 0 | 25k | rebalance per ROAS |
| Reserve buffer | 0 | 0 | 5-10k for opportunistic boost |

### Rebalancing rules (weekly, agent-suggested)

```
if channel.roas > 2.0 and other_channel.roas < 1.0:
    move 30% of other_channel.budget → this_channel
    require Telegram confirm

if channel.roas < 0.7 for 2 consecutive weeks:
    suggest pause channel ads
    redirect 100% to other channels
    require Telegram confirm

if both channels.roas > 1.5:
    maintain 50/50 split
    suggest opportunistic creative refresh
```

### Spark Ads daily budget per video

| Video performance | Recommended boost |
|---|---|
| Top 1% (viral organic) | 2,000-3,000฿/day for 7d |
| Top 5% (strong organic) | 800-1,500฿/day for 5d |
| Top 10% (good organic) | 500-800฿/day for 3d |
| Below top 10% | No boost |

---

## 8. Out of Scope (Phase 1)

- Live shopping operations (deferred to Phase 4 experiment)
- Programmatic TikTok Shop API integration (no public API; manual export)
- Cross-platform (Shopee/Lazada affiliate) — TikTok-only initially
- Brand partnership/sponsorship deals — defer until 1 channel reaches 10k followers
- Multi-language (English/Chinese) — Thai-only
- Custom voice cloning — use ElevenLabs stock voices
- Inventory dropshipping — pure affiliate, no own products
- Long-form content (3-10 min for Creator Rewards) — deferred until base monetization stable
- BESTCHOICE integration of any kind — strict separation

---

## 9. Success Definition

### Minimum viable success (Day 91)

- ทั้ง 2 channels live with 30+ videos each
- ≥ 1 channel showing ROAS > 1.5 during ads phase
- Monthly net ≥ 0 (break-even)
- Agent automation reduces owner manual time to < 10 hr/wk

### Strong success (Day 91)

- Both channels profitable, ROAS > 2
- Monthly net ≥ 30k
- ≥ 3 winning videos identified (replicable formula)
- LIVE selling experiment positive

### Stretch success (Day 180)

- Net 80k+/mo
- 1 winning niche scaled to 5+ winning products
- Hired freelance editor (200-500฿/clip)
- Considering Channel 3 expansion

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| TikTok Shop policy change (commission, eligibility) | Med | High | Keep operations agile, monitor announcements weekly |
| Account ban for policy violation | Low | Critical | Compliance check on every script via /check-claims |
| ROAS never positive across both channels | Med | High | Phased budget, kill threshold, phase 5 pivot decision |
| Owner time creep > 12 hr/wk | High | Med | Agent automation aggressive, freelance editor at scale |
| AI voice quality drops / TikTok flags AI content | Low | Med | Use ElevenLabs premium voices, human-review before post |
| Clawback rate > 15% (bad product picks) | Med | Med | /check-impulse score must be > 70 before approve |
| Burnout (BESTCHOICE + this side hustle) | High | High | Hard cap 12 hr/wk, automate ruthlessly, kill non-winners |
| Hermes VM downtime | Low | Med | Existing systemd auto-restart, alert on cron miss |
| ElevenLabs API rate limit | Low | Low | Local cache mp3 by script_id, reuse |

---

## 11. Defaults applied (owner can override later)

| # | Question | Default |
|---|---|---|
| 1 | TikTok handles | Agent suggests 5 candidate handles per channel during Phase 1 setup; owner picks final |
| 2 | Initial product seed | Agent picks from TikTok Affiliate Center trending; owner approves first batch via Telegram |
| 3 | ElevenLabs tier | **Creator $22/mo (100 min)**, stock Thai voices, **no voice cloning** (Q1=A) |
| 4 | Higgsfield reuse | **Reuse** existing account (symlink credentials into `<profile>/home/.config/higgsfield/`) |
| 5 | Approval cadence | **Confirm only for ads boost > 500฿/day**; video uploads = no confirm needed |
| 6 | **HeyGen subscription** | **Starter $29/mo** for AI-avatar talking-head (10-20 ref photos required) |
| 7 | **Hedra subscription** | **Pro $30/mo** for face-to-video lip sync (or skip if HeyGen alone enough — re-evaluate Week 2) |
| 8 | **Content mix** | **60/20/10/10** (review / tip / story / trend) — Q2=A |
| 9 | **Privacy stance** | **Real face on public TikTok** (Q3=A); bio MUST NOT link to BESTCHOICE |

---

## 12. Implementation Checklist (preview, not detailed plan)

Will be expanded in writing-plans phase:

- [ ] Owner: register TikTok Shop Seller Center (Marketing variant)
- [ ] Owner: create 2 TikTok accounts + handles
- [ ] Owner: BotFather → `@affiliate_secretary_bot` token
- [ ] Owner: ElevenLabs subscription + 2 voice picks
- [ ] Claude: provision profile dir + systemd service
- [ ] Claude: SQLite schema + seed data
- [ ] Claude: implement 11 Telegram commands
- [ ] Claude: implement 5 cron jobs
- [ ] Claude: ElevenLabs MCP wrapper
- [ ] Claude: TikTok Shop CSV importer (manual export workflow)
- [ ] Claude: TH event calendar seed
- [ ] Claude: SOUL.md + persona prompts
- [ ] Both: end-to-end smoke test (`/products home` → upload first video)
- [ ] Document: runbook for monthly reconciliation
- [ ] Document: stop-loss decision tree

---

**Next step:** owner reviews this spec — if approved, invoke writing-plans skill to produce detailed implementation plan with subagent task breakdown.
