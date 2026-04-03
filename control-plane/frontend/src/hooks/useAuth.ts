import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { authApi } from '@/api/auth.api';
import { toast } from 'sonner';

export function useAuth() {
  const { user, isAuthenticated, setAuth, logout: storeLogout } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: (data) => {
      if (data.requires_2fa && data.temp_token) {
        // Redirect to 2FA page with temp token
        navigate('/2fa', { state: { temp_token: data.temp_token } });
        return;
      }
      if (data.user && data.accessToken) {
        setAuth(data.user, data.accessToken);
        toast.success('Logged in successfully');
        navigate('/loading');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const registerMutation = useMutation({
    mutationFn: (data: { email: string; password: string; name: string; inviteKey: string }) =>
      authApi.register(data),
    onSuccess: (data) => {
      setAuth(data.user, data.accessToken);
      toast.success('Account created successfully');
      navigate('/');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      storeLogout();
      queryClient.clear();
      navigate('/login');
    },
    onError: () => {
      storeLogout();
      queryClient.clear();
      navigate('/login');
    },
  });

  return {
    user,
    isAuthenticated,
    login: loginMutation.mutate,
    register: registerMutation.mutate,
    logout: logoutMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };
}

export function useCurrentUser() {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const data = await authApi.me();
      useAuthStore.getState().setAuth(data.user, useAuthStore.getState().accessToken ?? '');
      return data.user;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}
