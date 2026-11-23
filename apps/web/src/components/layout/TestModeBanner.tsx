import { useQuery } from '@tanstack/react-query';
import { testModeApi, testModeKeys } from '@/lib/api/test-mode';
import { AlertTriangle } from '@/lib/icons';

/**
 * App-wide loud banner shown on every page when test-mode is ON.
 * Test-mode bypasses credit check + customer OTP — must be visually impossible
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
      <AlertTriangle className="mr-1 inline-block size-4 align-text-bottom" aria-hidden="true" />
      โหมดทดสอบ — เช็คเครดิต/OTP ถูกปิด ห้ามใช้กับลูกค้าจริง
    </div>
  );
}
