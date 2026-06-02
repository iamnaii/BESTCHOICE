import { useQuery } from '@tanstack/react-query';
import { testModeApi, testModeKeys } from '@/lib/api/test-mode';

/**
 * App-wide loud banner shown on every page when test-mode is ON.
 * Test-mode bypasses credit check + OTP + 2FA — must be visually impossible
 * to miss so staff never run it against real customers.
 */
export default function TestModeBanner() {
  const { data } = useQuery({
    queryKey: testModeKeys.status,
    queryFn: testModeApi.get,
  });

  if (!data?.enabled) return null;

  return (
    <div
      data-testid="test-mode-banner"
      role="alert"
      className="bg-destructive text-destructive-foreground px-4 py-2 text-center text-sm font-semibold leading-snug"
    >
      ⚠️ โหมดทดสอบ — เช็คเครดิต/OTP/2FA ถูกปิด ห้ามใช้กับลูกค้าจริง
    </div>
  );
}
