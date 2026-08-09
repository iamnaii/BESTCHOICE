import type { Prisma } from '@prisma/client';
import type { FlexMessagePayload } from '../line-oa/flex-messages/base-template';

/**
 * flex แจ้งลูกค้าเมื่อเงินเข้าแล้วแต่เครื่องถูกจำหน่ายไปก่อน — ต้องบอกตรงๆ ว่าจะคืนเงิน
 * (best-effort: ล้มก็แค่ warn — คิวคืนเงินฝั่งแอดมินคือแหล่งความจริง)
 *
 * B5 fix round 1/5 [reversal]: shared by BOTH `PaySolutionsConfirmationService`
 * (gateway webhook confirm) and `ShopOrdersService` (bank-transfer admin confirm) —
 * both paths can independently land an OnlineOrder in PAYMENT_RECEIVED_UNFULFILLABLE
 * and the customer needs to hear it from SOMEWHERE (grep 2026-08-05: this status
 * string does not appear anywhere in apps/web or apps/web-shop — the admin UI only
 * shows a generic success toast regardless of returned status). Originally copied
 * between the two services (T4 decision: "copy-adapt over extract, not enough shared
 * surface to be worth it") — that judgement call is what let the Critical bug in this
 * same fix round slip through (adapter-catch fallback copied without its `sale.findFirst`
 * guard layer). Extracting the one piece that's byte-identical (this builder) removes
 * that copy-drift risk going forward; the surrounding orchestration still legitimately
 * differs per-service and stays un-shared.
 */
export function buildOrderUnfulfillableFlex(order: {
  orderNumber: string;
  totalAmount: Prisma.Decimal;
  product: { name: string };
}): FlexMessagePayload {
  return {
    type: 'flex',
    altText: `คำสั่งซื้อ ${order.orderNumber} — เครื่องถูกจำหน่ายไปก่อน ทางร้านจะคืนเงิน`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'ขออภัยอย่างสูง', weight: 'bold', size: 'lg' },
          {
            type: 'text',
            text: `คำสั่งซื้อ ${order.orderNumber}`,
            size: 'md',
            margin: 'md',
          },
          { type: 'text', text: order.product.name, size: 'sm', color: '#666666', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'text',
            text: 'สินค้าถูกจำหน่ายไปก่อนที่การชำระเงินจะเข้าระบบ ทางร้านจะคืนเงินเต็มจำนวนให้ครับ/ค่ะ',
            size: 'sm',
            margin: 'md',
            wrap: true,
          },
          {
            type: 'text',
            text: `ยอดที่จะคืน ฿${Number(order.totalAmount).toLocaleString()}`,
            size: 'md',
            margin: 'md',
            weight: 'bold',
          },
          {
            type: 'text',
            text: 'ทีมงานจะติดต่อกลับเพื่อยืนยันช่องทางคืนเงินโดยเร็วที่สุด',
            size: 'xs',
            color: '#888888',
            margin: 'md',
            wrap: true,
          },
        ],
      },
    },
  };
}
