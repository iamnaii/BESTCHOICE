#!/bin/bash
# fb-app-review-preflight.sh
# Pre-submission checks for Facebook App Review (resubmit 2026-05).
# Verifies all the things Meta will check before screencast review.
#
# Usage:
#   ./tools/fb-app-review-preflight.sh
#
# Environment:
#   FB_APP_ID    — your Facebook App ID (optional; for App Mode check)
#
# Exits 0 if all checks pass, 1 otherwise.

set -u

PROD_DOMAIN="bestchoicephone.app"
API_DOMAIN="api.bestchoicephone.app"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
RESET='\033[0m'
BOLD='\033[1m'

PASS=0
FAIL=0
WARN=0

check_pass() { echo -e "${GREEN}PASS${RESET}  $1"; PASS=$((PASS+1)); }
check_fail() { echo -e "${RED}FAIL${RESET}  $1"; FAIL=$((FAIL+1)); }
check_warn() { echo -e "${YELLOW}WARN${RESET}  $1"; WARN=$((WARN+1)); }
section()    { echo; echo -e "${BOLD}── $1 ──${RESET}"; }

section "1. Privacy Policy URL (must be Meta-readable static HTML)"

PRIVACY_URL="https://${PROD_DOMAIN}/privacy.html"
PRIVACY_BODY=$(curl -sL --max-time 10 "$PRIVACY_URL" 2>/dev/null)
PRIVACY_CODE=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' "$PRIVACY_URL" 2>/dev/null)

if [ "$PRIVACY_CODE" = "200" ]; then
  check_pass "GET $PRIVACY_URL → 200"
else
  check_fail "GET $PRIVACY_URL → HTTP $PRIVACY_CODE (expected 200)"
fi

if echo "$PRIVACY_BODY" | grep -qE "<title>(Privacy Policy|นโยบายความเป็นส่วนตัว)"; then
  check_pass "Title identifies as Privacy Policy (Thai or English)"
else
  check_fail "Title doesn't identify as Privacy Policy (Meta crawler won't recognize)"
fi

if echo "$PRIVACY_BODY" | grep -qE 'name="robots"[^>]*content="[^"]*noindex'; then
  check_fail "noindex meta tag present (Meta crawler may skip)"
else
  check_pass "No noindex meta tag"
fi

if echo "$PRIVACY_BODY" | grep -qE "(Facebook Platform Data|ข้อมูลที่ได้รับผ่านแพลตฟอร์ม Facebook)"; then
  check_pass "Contains Facebook Platform Data section"
else
  check_warn "Missing Facebook Platform Data section (recommended by Meta)"
fi

if echo "$PRIVACY_BODY" | grep -qE 'กำลังโหลด|Loading|<div id="root">'; then
  check_fail "Looks like SPA shell (Meta won't see content)"
else
  check_pass "Server-rendered content (not SPA shell)"
fi

section "2. Terms of Service URL"

TERMS_URL="https://${PROD_DOMAIN}/terms.html"
TERMS_BODY=$(curl -sL --max-time 10 "$TERMS_URL" 2>/dev/null)
TERMS_CODE=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' "$TERMS_URL" 2>/dev/null)

if [ "$TERMS_CODE" = "200" ]; then
  check_pass "GET $TERMS_URL → 200"
else
  check_fail "GET $TERMS_URL → HTTP $TERMS_CODE"
fi

if echo "$TERMS_BODY" | grep -qE "<title>(Terms of Service|ข้อกำหนดและเงื่อนไขการใช้บริการ)"; then
  check_pass "Title identifies as Terms of Service (Thai or English)"
else
  check_fail "Title doesn't identify as Terms of Service"
fi

if echo "$TERMS_BODY" | grep -qE 'กำลังโหลด|<div id="root">'; then
  check_fail "Looks like SPA shell"
else
  check_pass "Server-rendered content"
fi

section "3. robots.txt — allows FB crawler on .html files"

ROBOTS=$(curl -sL --max-time 10 "https://${PROD_DOMAIN}/robots.txt" 2>/dev/null)

if echo "$ROBOTS" | grep -qE "Allow:[[:space:]]*/privacy\.html"; then
  check_pass "robots.txt allows /privacy.html"
else
  check_fail "robots.txt missing 'Allow: /privacy.html'"
fi

if echo "$ROBOTS" | grep -qE "Allow:[[:space:]]*/terms\.html"; then
  check_pass "robots.txt allows /terms.html"
else
  check_fail "robots.txt missing 'Allow: /terms.html'"
fi

if echo "$ROBOTS" | grep -q "facebookexternalhit"; then
  check_pass "robots.txt has explicit facebookexternalhit rule"
else
  check_warn "robots.txt missing 'facebookexternalhit' user-agent rule"
fi

section "4. Data Deletion Callback"

DEL_URL="https://${API_DOMAIN}/api/webhooks/facebook/data-deletion"
DEL_CODE=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' \
  -X POST "$DEL_URL" \
  -d 'signed_request=invalid' 2>/dev/null)

# Endpoint should respond (any code) — not 404 / DNS fail
if [ -z "$DEL_CODE" ] || [ "$DEL_CODE" = "000" ]; then
  check_fail "POST $DEL_URL — no response (DNS / network fail)"
elif [ "$DEL_CODE" = "404" ]; then
  check_fail "POST $DEL_URL → 404 (route not registered)"
else
  check_pass "POST $DEL_URL → HTTP $DEL_CODE (endpoint live, signature reject expected)"
fi

section "5. Deauthorize Callback"

DEAUTH_URL="https://${API_DOMAIN}/api/webhooks/facebook/deauthorize"
DEAUTH_CODE=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' \
  -X POST "$DEAUTH_URL" -d 'signed_request=invalid' 2>/dev/null)

if [ "$DEAUTH_CODE" = "404" ] || [ "$DEAUTH_CODE" = "000" ] || [ -z "$DEAUTH_CODE" ]; then
  check_fail "POST $DEAUTH_URL → HTTP $DEAUTH_CODE (route not live)"
else
  check_pass "POST $DEAUTH_URL → HTTP $DEAUTH_CODE (endpoint live)"
fi

section "6. App Review Panel reachable"

PANEL_URL="https://${PROD_DOMAIN}/settings/integrations"
PANEL_CODE=$(curl -sL --max-time 10 -o /dev/null -w '%{http_code}' "$PANEL_URL" 2>/dev/null)
if [ "$PANEL_CODE" = "200" ]; then
  check_pass "GET $PANEL_URL → 200 (admin panel reachable)"
else
  check_fail "GET $PANEL_URL → HTTP $PANEL_CODE"
fi

section "Summary"

echo
echo -e "  ${GREEN}PASS${RESET}: $PASS    ${YELLOW}WARN${RESET}: $WARN    ${RED}FAIL${RESET}: $FAIL"
echo

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}${BOLD}❌ Pre-flight FAILED. Fix the issues above before submitting App Review.${RESET}"
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}${BOLD}⚠ Pre-flight passed with warnings. Review optional items.${RESET}"
fi

echo -e "${GREEN}${BOLD}✓ Pre-flight passed. Ready to submit.${RESET}"
echo
echo "Next steps:"
echo "  1. Update FB App Settings:"
echo "     Privacy Policy URL = ${PRIVACY_URL}"
echo "     Terms of Service URL = ${TERMS_URL}"
echo "  2. Verify App Mode = Live"
echo "  3. Verify Business Verification = Approved"
echo "  4. Login admin → ยิง API ทุก endpoint ในแผง Facebook App Review"
echo "  5. รอ 24 ชม. → check App Dashboard activity status"
echo "  6. Record 8 screencasts (ดู docs/guides/FACEBOOK-APP-REVIEW-SUBMISSION.md)"
echo "  7. Submit"
exit 0
