import { useEffect, useState, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PresenceUser {
  userId: string;
  name: string;
}

interface PresenceAvatarsProps {
  projectId?: string;
  tableName?: string;
}

const COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
];

export function PresenceAvatars({ projectId, tableName }: PresenceAvatarsProps) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const channel = tableName
      ? `table:${projectId}:${tableName}`
      : `project:${projectId}`;

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/?channel=${channel}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'presence_update' && Array.isArray(msg.users)) {
            setUsers(msg.users);
          }
        } catch {
          // ignore
        }
      };

      return () => {
        ws.close();
        wsRef.current = null;
      };
    } catch {
      // WebSocket not available
      return;
    }
  }, [projectId, tableName]);

  if (users.length === 0) return null;

  const maxShow = 5;
  const shown = users.slice(0, maxShow);
  const overflow = users.length - maxShow;

  return (
    <div className="flex -space-x-2">
      {shown.map((user, i) => (
        <Tooltip key={user.userId}>
          <TooltipTrigger asChild>
            <Avatar className="h-7 w-7 border-2 border-background">
              <AvatarFallback className={`${COLORS[i % COLORS.length]} text-white text-[10px]`}>
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{user.name}</TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Avatar className="h-7 w-7 border-2 border-background">
          <AvatarFallback className="bg-muted text-muted-foreground text-[10px]">
            +{overflow}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
