import { offerContractPolicy } from './prepare-offer.policy';

describe('offerContractPolicy', () => {
  it('ไม่มีลูกค้า → ห้ามสร้างสัญญา บอกให้ผูกก่อน', () => {
    expect(offerContractPolicy({ customerId: null, placeholder: false })).toEqual({ canContract: false, nextStep: 'ผูกลูกค้ากับห้องแชทก่อนทำสัญญา' });
  });
  it('ผู้สนใจอัตโนมัติ → ห้ามสร้างสัญญา บอกให้เติมเบอร์/เลขบัตร', () => {
    expect(offerContractPolicy({ customerId: 'p1', placeholder: true })).toEqual({ canContract: false, nextStep: 'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา' });
  });
  it('ลูกค้าที่มีเบอร์ → สร้างสัญญาได้', () => {
    expect(offerContractPolicy({ customerId: 'c1', placeholder: false })).toEqual({ canContract: true, nextStep: 'ตรวจผลเครดิตและตารางผ่อนในหน้าสร้างสัญญาก่อนยืนยัน' });
  });
});
