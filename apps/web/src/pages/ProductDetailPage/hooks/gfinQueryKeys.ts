/** คีย์ query ชุดเดียวของ GFIN — useGfinTables (หน้าสินค้า) และหน้าตั้งค่าใช้ร่วมกัน — แก้ที่หน้าตั้งค่าแล้วหน้าสินค้าเห็นค่าใหม่ทันที */
export const GFIN_QUERY_KEYS = {
  prices: ['gfin-max-prices'],
  rules: ['gfin-overprice-rules'],
  factors: ['gfin-rate-factors'],
  settings: ['gfin-settings'],
} as const;
