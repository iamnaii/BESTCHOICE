import { Link } from 'react-router';

export default function ShopFooter() {
  return (
    <footer className="bg-muted mt-12 py-8">
      <div className="container mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
        <div>
          <h3 className="font-semibold mb-2">BESTCHOICE</h3>
          <p className="text-muted-foreground">ร้านขายไอโฟนผ่อนได้ลพบุรี</p>
        </div>
        <div>
          <h3 className="font-semibold mb-2">บริการ</h3>
          <ul className="space-y-1">
            <li><Link to="/products">สินค้าทั้งหมด</Link></li>
            <li><Link to="/how-it-works">วิธีซื้อ</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mb-2">นโยบาย</h3>
          <ul className="space-y-1">
            <li><Link to="/shipping">การจัดส่ง</Link></li>
            <li><Link to="/returns">การคืนสินค้า</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-semibold mb-2">ติดต่อ</h3>
          <p className="text-muted-foreground">LINE: @bestchoice<br/>โทร: 0XX-XXX-XXXX</p>
        </div>
      </div>
      <div className="container mx-auto px-4 mt-6 text-center text-xs text-muted-foreground">
        © 2026 BESTCHOICE Phone Shop — ลพบุรี
      </div>
    </footer>
  );
}
