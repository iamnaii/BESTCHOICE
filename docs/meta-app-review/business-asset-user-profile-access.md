# Meta App Review — Business Asset User Profile Access

**Purpose**: Submit a request to Meta for `Business Asset User Profile Access` feature so the chat inbox can show real Facebook customer names + profile photos (instead of the DiceBear fallback shipped in PR #1091).

**App ID**: 2736219233418171
**Business ID**: 1766813540286850
**Page ID** (in scope): 720894941321356 — "Bestchoice ผ่อนไอโฟน ใช้บัตรประชาชนใบเดียว ลพบุรี"

---

## When to submit

**Only after** the current 9-permission review (submitted 2026-05-24) returns a result — submitting in parallel pauses the existing review and resets the 10-day timer.

| Current review outcome | Next action |
|---|---|
| `pages_messaging` Advanced Access approved | **Skip this feature** — code in PR #1092 starts fetching real photos automatically |
| `pages_messaging` rejected or downgraded to Standard | **Submit this feature** as alternative path |
| All 9 permissions rejected | **Submit this feature** + revise screencast |

---

## Pre-submission checklist

- [ ] Create dedicated reviewer account at `/users`:
  - Email: `meta-reviewer@bestchoice.com`
  - Password: strong unique (don't reuse production passwords)
  - Role: `OWNER` (needs to see `/inbox` + all features)
  - **Disable 2FA** on this account until review completes
- [ ] Privacy policy live: `https://bestchoicephone.app/privacy` ✅
- [ ] Data deletion instructions live: `https://bestchoicephone.app/privacy/data-deletion` ✅ (PR #1093)
- [ ] At least 5 real FB customer conversations visible in `/inbox` (for reviewer to see)
- [ ] Record fresh screencast (Meta sometimes rejects reused videos)

---

## Navigation: how to add the request in Meta dashboard

1. Go to **https://developers.facebook.com/apps/2736219233418171**
2. Left sidebar → **ตรวจสอบ** (App Review) → **การตรวจพิจารณาแอพ** (App Review)
3. Click **"ส่งคำขอใหม่"** (Submit New Request) or **"Request Permissions and Features"**
4. In the search box, type: `Business Asset User Profile Access`
5. Click **"Request"** on the matching row
6. Fill out the form fields below (copy/paste from each section)
7. Upload screencast `.mov` or `.mp4`
8. Submit

---

## Form field: "How will your app use this feature?"

```
BESTCHOICE is an internal CRM system used exclusively by our own
employees at a Thai retail business (mobile phones + installment
financing). We are NOT a technology provider — we use Meta APIs
solely to manage our own Facebook Page "Bestchoice ผ่อนไอโฟน ใช้
บัตรประชาชนใบเดียว ลพบุรี" (Page ID: 720894941321356).

USE CASE FOR THIS FEATURE:
Our shop receives ~50-100 Messenger inquiries per day from customers
asking about phone models, installment plans, and document
requirements. Our staff needs to identify which physical customer
they are talking to (Thai customers often have very similar names),
so showing the customer's Facebook display name and profile photo
in our internal inbox is essential for:

1. Distinguishing between multiple "สมชาย" (very common Thai name)
   conversations open simultaneously
2. Personalizing replies ("คุณ Wiwat, มือถือรุ่นไหนที่สนใจครับ?")
3. Matching anonymous PSIDs to known walk-in customers (when the
   same person who messaged also visited the shop with their ID
   card) so we can link their chat to their installment contract

DATA HANDLING:
- We fetch ONLY `name` and `profile_pic` (no email, locale, gender)
- Data is stored in our PostgreSQL database (Google Cloud SQL,
  encrypted at rest) only for users who have already messaged our
  Page (no proactive lookup)
- Data is shown only to authenticated employees of BESTCHOICE
- Customers can request deletion via:
  https://bestchoicephone.app/privacy/data-deletion
- Retention: deleted when the customer requests deletion, or
  automatically after 24 months of inactivity per our PDPA policy

We have already completed Business Verification and are NOT
seeking Advanced Access for external/public use.
```

---

## Form field: "Step-by-step instructions for testing"

```
1. Open https://bestchoicephone.app in a desktop browser.

2. Click "เข้าสู่ระบบ" (Login) and use the test credentials below:
   Email:    meta-reviewer@bestchoice.com
   Password: <paste-strong-password-here-before-submitting>

3. Once logged in, you will land on the Dashboard. From the left
   sidebar, click "รวมแชท" (Unified Inbox) — or navigate directly
   to https://bestchoicephone.app/inbox

4. You will see a list of conversations from real customers who
   have messaged our Facebook Page "Bestchoice ผ่อนไอโฟน".

   Each conversation card displays:
   - Customer's Facebook display name (from Business Asset User
     Profile Access)
   - Customer's Facebook profile photo (from Business Asset User
     Profile Access) — small circular thumbnail on the left

5. Filter to Facebook-only conversations by clicking the
   "Facebook" chip in the channel filter.

6. Click any Facebook conversation. The chat opens in the center
   panel. The customer's name and profile photo appear in the
   header at the top, also fetched via Business Asset User
   Profile Access.

7. On the right side, the "ข้อมูลลูกค้า" (Customer Info) panel
   shows the same name + photo with options to link the chat to
   our internal customer database.

8. To verify the underlying API call: open browser DevTools →
   Network tab → reload the inbox → look for an API request to
   our backend (/api/staff-chat/rooms). The response contains a
   `pictureUrl` field pointing to platform-lookaside.fbsbx.com —
   the profile_pic URL returned by Meta's Graph API for this
   feature.

EXPECTED RESULT: Customer Facebook profile names and photos
appear next to each conversation, enabling staff to identify
who they are talking to.

If profile photos do NOT appear (showing default cartoon avatars
instead), it means Meta's approval for this feature has not yet
been granted — please proceed with the approval and our system
will start fetching real photos automatically on the next inbound
message.
```

---

## Form field: URLs

| Field | Value |
|---|---|
| Privacy Policy URL | `https://bestchoicephone.app/privacy` |
| Data Deletion URL | `https://bestchoicephone.app/privacy/data-deletion` |
| Terms of Service URL | `https://bestchoicephone.app/terms` |

---

## Screencast script (60-90 seconds)

| Time | Action |
|---|---|
| 00:00 – 00:10 | Open browser, navigate to https://bestchoicephone.app. Show login screen, type test credentials, click login. |
| 00:10 – 00:25 | Land on Dashboard. Click "รวมแชท" in sidebar. Show the inbox with multiple Facebook conversations. Hover/zoom on one to highlight customer's profile photo + name in the conversation card. |
| 00:25 – 00:45 | Click one Facebook conversation. Show chat header with customer name + photo on top. Open right panel ("ข้อมูลลูกค้า") — point at the customer info display. |
| 00:45 – 01:00 | Open DevTools → Network tab → reload page → click on `/api/staff-chat/rooms` response → highlight the `pictureUrl` field showing `platform-lookaside.fbsbx.com` URL. |
| 01:00 – 01:30 | Voiceover or text overlay: "BESTCHOICE uses Business Asset User Profile Access solely to display customer names and profile photos in our internal staff inbox, helping employees identify who they are replying to. Data is fetched only for users who have messaged our Page, stored encrypted, and visible only to authenticated staff." |

**Recording tool (Mac)**: `Cmd + Shift + 5` → "Record Selected Portion" → save as `.mov` → upload directly to Meta form.

---

## Implementation reference (code already in place)

The endpoint is already wired in [apps/api/src/modules/chat-adapters/facebook.adapter.ts](../../apps/api/src/modules/chat-adapters/facebook.adapter.ts):

```typescript
GET https://graph.facebook.com/v25.0/{PSID}?fields=name,profile_pic
&access_token={PAGE_ACCESS_TOKEN}
```

- Today (without this feature): returns `400 error 100/33` → adapter falls through to `/me/conversations` workaround (name only, no photo) → frontend shows DiceBear cartoon
- After approval: returns `200 {name, profile_pic}` → `room.pictureUrl` populated with `platform-lookaside.fbsbx.com/...` URL → frontend shows real photo automatically on next inbound message

**No further deploy needed after approval** — the adapter is forward-compatible.

---

## Post-submission

1. Meta typically responds in 3-10 business days
2. Check status at: developers.facebook.com → App Review → Submission History
3. If approved → **delete the `meta-reviewer@bestchoice.com` account immediately**
4. If rejected → read the rejection reason carefully and revise (don't resubmit identical content)

## Common rejection reasons (and fixes)

| Reason | Fix |
|---|---|
| "Screencast doesn't clearly demonstrate the permission" | Re-record showing the API response with `pictureUrl` field clearly visible in DevTools |
| "Privacy policy doesn't mention FB data" | Update `/privacy` to explicitly mention "ข้อมูลจาก Facebook (ชื่อ, รูปโปรไฟล์)" |
| "Test instructions unclear" | Add more specific click paths + expected outcomes for each step |
| "Business not verified" | Already done ✅ |
| "Use case too broad" | Narrow to specific feature (just chat inbox, not analytics/ads) |
