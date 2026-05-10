#!/bin/bash
# fb-app-review-smoke.sh
# Smoke-test all Facebook App Review endpoints to generate "Activity detected"
# entries in the FB App Dashboard within 24 hours.
#
# Usage:
#   API=https://api.bestchoicephone.app TOKEN=<jwt> ./tools/fb-app-review-smoke.sh
#   API=https://api.bestchoicephone.app EMAIL=admin@bestchoice.com PASSWORD=admin1234 ./tools/fb-app-review-smoke.sh
#
# Required:
#   API   — backend API URL (e.g. https://api.bestchoicephone.app)
#   TOKEN — OWNER JWT access token (skip if EMAIL+PASSWORD provided)
#
# Optional inputs (per-permission):
#   FB_TEST_PSID       — PSID who messaged Page within 24 hr (for pages_messaging tests)
#   FB_TEST_POST_ID    — Post ID with comments (for post-comments test)
#   FB_TEST_COMMENT_ID — Comment ID under our post (for comment-* tests)
#   FB_TEST_BM_ID      — Business Manager ID (for business_management nested tests)

set -u

API="${API:-}"
TOKEN="${TOKEN:-}"
EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'
BOLD='\033[1m'

if [ -z "$API" ]; then
  echo -e "${RED}Missing API env var. Example:${RESET}"
  echo "  API=https://api.bestchoicephone.app TOKEN=<jwt> ./tools/fb-app-review-smoke.sh"
  exit 1
fi

if [ -z "$TOKEN" ] && { [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; }; then
  echo -e "${RED}Provide either TOKEN or EMAIL+PASSWORD.${RESET}"
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo -e "${BLUE}Logging in as $EMAIL...${RESET}"
  TOKEN=$(curl -sL --max-time 15 -X POST "$API/api/auth/login" \
    -H 'Content-Type: application/json' \
    -H 'X-Requested-With: XMLHttpRequest' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    | sed -n 's/.*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

  if [ -z "$TOKEN" ]; then
    echo -e "${RED}Login failed. Check credentials.${RESET}"
    exit 1
  fi
  echo -e "${GREEN}Login OK${RESET}"
fi

PASS=0; FAIL=0

call_api() {
  local label="$1" method="$2" path="$3" body="${4:-}"
  echo -en "${BLUE}→${RESET}  ${BOLD}$label${RESET}  $method $path  "

  local args=(-sL --max-time 30 -o /tmp/fb-smoke-resp -w '%{http_code}'
              -H "Authorization: Bearer $TOKEN"
              -H 'X-Requested-With: XMLHttpRequest'
              -X "$method")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' -d "$body")
  fi

  local code
  code=$(curl "${args[@]}" "$API$path" 2>/dev/null)
  local resp
  resp=$(cat /tmp/fb-smoke-resp 2>/dev/null | head -c 500)

  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    echo -e "${GREEN}HTTP $code OK${RESET}"
    PASS=$((PASS+1))
    return 0
  fi

  echo -e "${RED}HTTP $code FAIL${RESET}"
  echo "    Response: $resp"
  FAIL=$((FAIL+1))
  return 1
}

skip_test() {
  local label="$1" reason="$2"
  echo -e "${YELLOW}~${RESET}  ${BOLD}$label${RESET}  ${YELLOW}SKIP${RESET}  ($reason)"
}

echo
echo "${BOLD}── 1. pages_show_list ──${RESET}"
call_api "List managed Pages" GET '/api/facebook/app-review/pages'

echo
echo "${BOLD}── 2. pages_read_engagement ──${RESET}"
call_api "List Page posts" GET '/api/facebook/app-review/page-posts'
if [ -n "${FB_TEST_POST_ID:-}" ]; then
  call_api "List post comments" GET "/api/facebook/app-review/post-comments/$FB_TEST_POST_ID"
else
  skip_test "List post comments" "set FB_TEST_POST_ID"
fi

echo
echo "${BOLD}── 3. business_management ──${RESET}"
call_api "List Businesses" GET '/api/facebook/app-review/businesses'
if [ -n "${FB_TEST_BM_ID:-}" ]; then
  call_api "List BM ad accounts" GET "/api/facebook/app-review/businesses/$FB_TEST_BM_ID/ad-accounts"
  call_api "List BM pages"       GET "/api/facebook/app-review/businesses/$FB_TEST_BM_ID/pages"
else
  skip_test "List BM ad accounts" "set FB_TEST_BM_ID"
  skip_test "List BM pages"       "set FB_TEST_BM_ID"
fi

echo
echo "${BOLD}── 4. ads_read ──${RESET}"
call_api "Ad insights (30d)" GET '/api/facebook/app-review/insights'

echo
echo "${BOLD}── 5. pages_messaging (RESPONSE) ──${RESET}"
if [ -n "${FB_TEST_PSID:-}" ]; then
  call_api "Send 24-hr response" POST '/api/facebook/app-review/messenger-message' \
    "{\"recipientPsid\":\"$FB_TEST_PSID\",\"text\":\"Smoke test reply (will be deleted)\"}"
else
  skip_test "Send 24-hr response" "set FB_TEST_PSID (PSID who messaged Page within 24hr)"
fi

echo
echo "${BOLD}── 6. pages_utility_messaging (template) ──${RESET}"
if [ -n "${FB_TEST_PSID:-}" ]; then
  call_api "Send template message" POST '/api/facebook/app-review/template-message' \
    "{\"recipientPsid\":\"$FB_TEST_PSID\",\"templateKey\":\"payment_due_reminder\",\"customerName\":\"Smoke Test\",\"orderId\":\"CT-2025-001\",\"amount\":\"3,500\",\"dueDate\":\"15 มิ.ย. 2569\"}"
else
  skip_test "Send template message" "set FB_TEST_PSID"
fi

echo
echo "${BOLD}── 7. pages_manage_metadata ──${RESET}"
call_api "Subscribe webhooks" POST '/api/facebook/app-review/subscribe-webhooks' \
  '{"fields":"messages,messaging_postbacks,message_deliveries,message_reads,feed"}'

echo
echo "${BOLD}── 8. pages_manage_engagement ──${RESET}"
if [ -n "${FB_TEST_COMMENT_ID:-}" ]; then
  call_api "Reply to comment" POST '/api/facebook/app-review/comment-reply' \
    "{\"commentId\":\"$FB_TEST_COMMENT_ID\",\"message\":\"Smoke test reply\"}"
  call_api "Like comment" POST '/api/facebook/app-review/comment-like' \
    "{\"commentId\":\"$FB_TEST_COMMENT_ID\"}"
  # Skip hide — hides comment publicly, would need un-hide cleanup
  skip_test "Hide comment" "destructive — test manually via panel"
else
  skip_test "Reply to comment" "set FB_TEST_COMMENT_ID"
  skip_test "Like comment"     "set FB_TEST_COMMENT_ID"
  skip_test "Hide comment"     "set FB_TEST_COMMENT_ID"
fi

echo
echo "${BOLD}── Summary ──${RESET}"
echo -e "  ${GREEN}PASS${RESET}: $PASS  ${RED}FAIL${RESET}: $FAIL"
echo
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Some smoke tests failed. Check responses above.${RESET}"
  exit 1
fi
echo -e "${GREEN}All smoke tests passed.${RESET}"
echo "→ Wait 24 hr → check FB App Dashboard for 'Activity detected within 30 days' on each permission."
exit 0
