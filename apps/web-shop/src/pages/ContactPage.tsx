import ShopLayout from '@/components/layout/ShopLayout';

export default function ContactPage() {
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-3xl font-bold mb-6">ติดต่อเรา</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold">LINE Official Account</h3>
              <a href="https://line.me/R/ti/p/@bestchoice" className="text-primary">@bestchoice</a>
            </div>
            <div>
              <h3 className="font-semibold">โทรศัพท์</h3>
              <p>0XX-XXX-XXXX</p>
            </div>
            <div>
              <h3 className="font-semibold">Facebook</h3>
              <p>fb.com/bestchoicephoneshop</p>
            </div>
            <div>
              <h3 className="font-semibold">เวลาเปิด</h3>
              <p>ทุกวัน 09:00-19:00</p>
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-2">ที่ตั้งร้าน</h3>
            <p>ลพบุรี (รายละเอียดที่อยู่ + Google Map embed)</p>
            {/* TODO: embed Google Map iframe — owner provides coordinates */}
          </div>
        </div>
      </div>
    </ShopLayout>
  );
}
