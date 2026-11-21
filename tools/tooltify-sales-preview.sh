#!/usr/bin/env bash
# Keep this process running for the local handoff. To stop, create STOP in the printed run directory.
set -eu
cd "$(dirname "$0")/.."
repo=$(pwd -P)
# Nest ConfigModule loads these files even with an otherwise empty environment.
for path in .env ../.env apps/.env apps/api/.env apps/api/src/.env; do
  if [ -e "$path" ]; then echo "Use an isolated checkout without $path" >&2; exit 1; fi
done
mkdir -p .tmp/tooltify-sales
out=$(mktemp -d "$repo/.tmp/tooltify-sales/run.XXXXXXXX")
printf 'Tooltify preview run directory: %s\n' "$out"
exec env -i PATH="$PATH" HOME="$HOME" LANG=en_US.UTF-8 \
  DOCS_QA_RUN_ID="$(basename "$out")" DOCS_QA_OUTPUT="$out" \
  TOOLTIFY_SALES_PREVIEW=1 CRON_ENABLED=false REDIS_HOST='' \
  bash tools/docs-integration.sh --runInBand --transform '{"^.+\\.ts$":["ts-jest",{"tsconfig":{"isolatedModules":true}}]}' --runTestsByPath e2e/documents/tooltify-sales-preview.docs-spec.ts
