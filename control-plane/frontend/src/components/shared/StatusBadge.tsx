import { Badge } from '@/components/ui/badge';

type Status = 'active' | 'inactive' | 'error' | 'pending' | 'success';

const statusConfig: Record<Status, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground' },
  error: { label: 'Error', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  pending: { label: 'Pending', className: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
  success: { label: 'Success', className: 'bg-green-500/10 text-green-500 border-green-500/20' },
};

interface StatusBadgeProps {
  status: Status;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={config.className}>
      {label ?? config.label}
    </Badge>
  );
}
