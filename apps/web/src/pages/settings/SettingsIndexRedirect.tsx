import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { firstVisibleCategoryId } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

// hash tab เดิม (#vat ฯลฯ) → หมวดใหม่. item id ที่ตรงกับ hash จะถูกใช้ anchor ต่อ
export const HASH_TO_CATEGORY: Record<string, string> = {
  company: 'company',
  vat: 'accounting',
  periods: 'accounting',
  'peak-mapping': 'accounting',
  attachment: 'access',
  'internal-control': 'access',
  users: 'access',
  'offsite-backup': 'system',
  pdpa: 'system',
};

export function SettingsIndexRedirect() {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const navigate = useNavigate();

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    // #contacts is now a standalone page — redirect directly
    if (hash === 'contacts') {
      navigate('/contacts', { replace: true });
      return;
    }
    const mapped = HASH_TO_CATEGORY[hash];
    if (mapped) {
      // คง hash เป็น anchor ไปยัง section (item id ที่ตรงกับ hash ถ้ามี)
      navigate(`/settings/${mapped}#${hash}`, { replace: true });
      return;
    }
    const first = firstVisibleCategoryId(role);
    if (first) navigate(`/settings/${first}`, { replace: true });
  }, [role, navigate]);

  return null;
}
