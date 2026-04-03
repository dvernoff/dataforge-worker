import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export function useAIEnabled() {
  const { data } = useQuery({
    queryKey: ['system-settings-public'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings/public'),
    staleTime: 60_000,
  });

  const aiConfigured = data?.settings?.ai_configured === 'true';
  return { aiConfigured };
}
