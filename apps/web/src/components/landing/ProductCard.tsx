interface ProductCardProps {
  name: string;
  brand: string;
  model: string;
  price: string;
  category: string;
  image?: string;
  conditionGrade?: string | null;
  status: string;
}

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

const gradeBadgeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-yellow-100 text-yellow-700',
  D: 'bg-orange-100 text-orange-700',
};

export default function ProductCard({
  brand,
  model,
  price,
  category,
  conditionGrade,
}: ProductCardProps) {
  const categoryLabel = categoryLabels[category] || category;
  const gradeColor = conditionGrade ? (gradeBadgeColors[conditionGrade] || 'bg-gray-100 text-gray-700') : '';

  return (
    <div className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      {/* Image Placeholder */}
      <div className="relative h-48 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <svg className="w-16 h-16 text-gray-300 mx-auto group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <p className="text-xs text-gray-400 mt-1">{brand}</p>
        </div>

        {/* Category Badge */}
        <span className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-semibold bg-primary-600 text-white rounded-full">
          {categoryLabel}
        </span>

        {/* Grade Badge */}
        {conditionGrade && (
          <span className={`absolute top-3 right-3 px-2 py-1 text-[10px] font-bold rounded-full ${gradeColor}`}>
            Grade {conditionGrade}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 text-sm">{brand} {model}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{categoryLabel}</p>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-xs text-gray-400">เริ่มต้นที่</p>
            <p className="text-lg font-bold text-primary-600">
              {parseFloat(price).toLocaleString()}
              <span className="text-sm font-normal text-gray-500 ml-1">฿</span>
            </p>
          </div>
          <button className="px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors">
            ดูรายละเอียด
          </button>
        </div>
      </div>
    </div>
  );
}
