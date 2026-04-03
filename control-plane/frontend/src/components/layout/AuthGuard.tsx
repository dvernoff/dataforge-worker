import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { LoadingPage } from '@/components/shared/LoadingPage';

/**
 * Wraps authenticated routes. On mount (page refresh), tries to restore
 * the session via the httpOnly refresh-token cookie before redirecting
 * to /login.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setAuth } = useAuthStore();
  const [checking, setChecking] = useState(!isAuthenticated);
  const location = useLocation();

  useEffect(() => {
    // Already authenticated (navigated from login, not a page refresh)
    if (isAuthenticated) {
      setChecking(false);
      return;
    }

    // Try to restore session via refresh token cookie
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });

        if (res.ok && !cancelled) {
          const data = await res.json() as {
            accessToken: string;
            user: {
              id: string;
              email: string;
              name: string;
              is_superadmin: boolean;
              is_active: boolean;
              last_login_at: string | null;
              created_at: string;
              updated_at: string;
            };
          };
          setAuth(data.user, data.accessToken);
        }
      } catch {
        // Cookie missing or expired — will redirect to login
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return <LoadingPage />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
