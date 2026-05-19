import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

/**
 * SP7.7 — Opening balance transfer JE (FINANCE → SHOP on cutover day).
 *
 * BLOCKED until CPA approves OQ4 (per design spec). This is the skeleton
 * structure; actual amounts + accounts per leg come from CPA-approved
 * transfer plan (signed before 2026-08-XX).
 *
 * When unblocked, this script will:
 *   1. Read approved transfer plan (JSON file)
 *   2. POST 1 JE in bc_finance: Dr (capital injection to SHOP) / Cr inventory + AR + AP
 *   3. POST 1 JE in bc_shop: Dr inventory + AR + AP / Cr owner's equity
 *   4. Cross-link both JEs via outbox_event (idempotent)
 *
 * Required env (when unblocked):
 *   CPA_APPROVED_PLAN_PATH — path to JSON with transfer legs
 *   CONFIRM_POST=YES_I_AM_SURE
 */

const logger = new Logger('OpeningBalanceTransferSP7');

async function main() {
  logger.error(
    'BLOCKED: CPA approval of OQ4 (opening balance transfer plan) required before execution.',
  );
  logger.error(
    'See docs/superpowers/specs/2026-05-19-shop-finance-legal-split-design.md OQ4',
  );
  logger.error('Expected unblock: 2026-08-XX after CPA consult');
  process.exit(1);
}

main();
