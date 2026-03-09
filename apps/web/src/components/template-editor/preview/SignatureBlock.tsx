export default function SignatureBlock() {
  const signatures = [
    { label: 'ผู้ให้เช่าซื้อ', tag: '@sign_company' },
    { label: 'ผู้เช่าซื้อ', tag: '@sign_customer' },
    { label: 'พยาน', tag: '@sign_witness1' },
    { label: 'พยาน', tag: '@sign_witness2' },
  ];

  return (
    <div className="my-6 grid grid-cols-2 gap-x-8 gap-y-8">
      {signatures.map((sig, i) => (
        <div key={i} className="text-center">
          <div className="mb-1 text-[13px]">
            ลงชื่อ..................................................{sig.label}
          </div>
          <div className="text-[12px] text-gray-500">
            ({' '.repeat(30)})
          </div>
        </div>
      ))}
    </div>
  );
}
