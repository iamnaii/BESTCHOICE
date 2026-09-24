// Task 6: proxy คำขอมีราคา — re-export ตัวเดิมของ contract-exchange ตรง ๆ (ไม่มี field ต่างกัน,
// ห้ามสร้างสำเนาที่สอง — `ApproveExchangeRequestDto` มีแค่ 2 checkbox ที่ MEMO mode ใช้เท่านั้น
// แต่ engine เดียวกันรับ dto ตัวเดียวกันทั้งสองโหมด (PRICED mode เพิกเฉยต่อ 2 ฟิลด์นี้)).
export { ApproveExchangeRequestDto } from '../../contract-exchange/dto/approve-exchange-request.dto';
