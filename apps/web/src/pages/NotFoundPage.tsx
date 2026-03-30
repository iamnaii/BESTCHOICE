import { Link, useLocation } from 'react-router-dom';

export default function NotFoundPage() {
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="text-8xl font-bold text-muted-foreground/30">404</div>
      <h1 className="text-2xl font-semibold">ไม่พบหน้าที่ต้องการ</h1>
      <p className="text-muted-foreground text-sm">
        ไม่พบ <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{pathname}</code>
      </p>
      <Link
        to="/"
        className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
      >
        กลับหน้าหลัก
      </Link>
    </div>
  );
}
