#!/bin/bash
# Upload the 1×3 Chromatic Shrine rich menu to the BESTCHOICE FINANCE OA.
# Usage:
#
#   export LINE_FINANCE_CHANNEL_TOKEN="..."   # จาก /settings/integrations
#   export FINANCE_LIFF_ID="2000000000-xxxxxxx"
#   bash docs/designs/rich-menu/upload-3.sh
#
# What it does:
#   1. Creates a new rich-menu record on LINE from rich-menu-config-3.json
#      (LIFF_ID placeholder is substituted with $FINANCE_LIFF_ID on the fly)
#   2. Uploads bestchoice-finance-rich-menu-3.png (2500×843) as its image
#   3. Sets the new menu as default for every OA follower
#
# Reference: https://developers.line.biz/en/reference/messaging-api/#rich-menu

set -euo pipefail

if [ -z "${LINE_FINANCE_CHANNEL_TOKEN:-}" ]; then
  echo "error: LINE_FINANCE_CHANNEL_TOKEN is not set"
  echo "hint : copy from Integration Hub → Settings → LINE Finance → Channel Access Token"
  exit 1
fi
if [ -z "${FINANCE_LIFF_ID:-}" ]; then
  echo "error: FINANCE_LIFF_ID is not set (e.g. 2000000000-abcdefgh)"
  echo "hint : admin → /settings/line-oa shows the LIFF ID in the integration config"
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="$DIR/bestchoice-finance-rich-menu-3.png"
CONFIG_TEMPLATE="$DIR/rich-menu-config-3.json"

if [ ! -f "$IMAGE" ]; then
  echo "error: image not found: $IMAGE"
  echo "hint : run  python3 docs/designs/rich-menu/generate-3.py  first"
  exit 1
fi
if [ ! -f "$CONFIG_TEMPLATE" ]; then
  echo "error: config template not found: $CONFIG_TEMPLATE"
  exit 1
fi

# Substitute REPLACE_LIFF_ID → actual id, write to a temp file
TMP_CONFIG="$(mktemp)"
trap 'rm -f "$TMP_CONFIG"' EXIT
sed "s/REPLACE_LIFF_ID/$FINANCE_LIFF_ID/g" "$CONFIG_TEMPLATE" > "$TMP_CONFIG"

echo "→ Creating rich menu on LINE..."
RESPONSE=$(curl -sS -X POST https://api.line.me/v2/bot/richmenu \
  -H "Authorization: Bearer $LINE_FINANCE_CHANNEL_TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$TMP_CONFIG")
RICH_MENU_ID=$(echo "$RESPONSE" | grep -oE '"richMenuId":"[^"]+"' | cut -d'"' -f4)

if [ -z "$RICH_MENU_ID" ]; then
  echo "error: LINE rejected the config"
  echo "response: $RESPONSE"
  exit 1
fi
echo "  richMenuId: $RICH_MENU_ID"

echo "→ Uploading image (2500×843)..."
curl -sS -X POST "https://api-data.line.me/v2/bot/richmenu/$RICH_MENU_ID/content" \
  -H "Authorization: Bearer $LINE_FINANCE_CHANNEL_TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @"$IMAGE"
echo ""

echo "→ Setting as default for all followers..."
curl -sS -X POST "https://api.line.me/v2/bot/user/all/richmenu/$RICH_MENU_ID" \
  -H "Authorization: Bearer $LINE_FINANCE_CHANNEL_TOKEN"
echo ""
echo ""
echo "✓ done · rich menu active: $RICH_MENU_ID"
echo ""
echo "To remove (revert to no menu):"
echo "  curl -X DELETE https://api.line.me/v2/bot/user/all/richmenu \\"
echo "    -H \"Authorization: Bearer \$LINE_FINANCE_CHANNEL_TOKEN\""
echo ""
echo "To list existing rich menus:"
echo "  curl -H \"Authorization: Bearer \$LINE_FINANCE_CHANNEL_TOKEN\" \\"
echo "    https://api.line.me/v2/bot/richmenu/list"
