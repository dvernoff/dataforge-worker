import { Badge } from '@/components/ui/badge';

const roleConfig: Record<string, { className: string }> = {
  superadmin: { className: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
  admin: { className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  editor: { className: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  viewer: { className: 'bg-muted text-muted-foreground' },
};

interface RoleBadgeProps {
  role: string;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const config = roleConfig[role] ?? roleConfig.viewer;
  return (
    <Badge variant="outline" className={config.className}>
      {role.toUpperCase()}
    </Badge>
  );
}
