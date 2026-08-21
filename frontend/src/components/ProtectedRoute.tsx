import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
}

export function ProtectedRoute({ children, requireSuperAdmin }: ProtectedRouteProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // P4.1: 等 zustand v5 persist hydrate 完成后再决定 Navigate
  // 否则 reload 时 ProtectedRoute 会看到 initial null accessToken 踢回 login 页
  // (axios 拦截器同时收到 401 → logout() → ls 被覆盖清空, 即便 hydrate 完了也来不及)
  const [hydrated, setHydrated] = useState(useAuthStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);

  if (!hydrated) return null;  // 等 hydrate, 不 Navigate

  if (!accessToken || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireSuperAdmin && !user.is_super_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
