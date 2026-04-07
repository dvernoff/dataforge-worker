import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePageTitle } from '@/hooks/usePageTitle';
import { rolesApi, type Role, type CreateRoleInput } from '@/api/roles.api';
import { toast } from 'sonner';

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  '#6B7280', '#14B8A6', '#A855F7', '#F43F5E',
  '#84CC16', '#0EA5E9', '#6366F1', '#D946EF',
];

const QUOTA_GROUPS = [
  {
    key: 'resources',
    fields: ['max_projects'],
  },
] as const;

const QUOTA_DEFAULTS: Record<string, number> = {
  max_projects: 10,
};

function formatQuotaSummary(role: Role) {
  const parts: string[] = [];
  if (role.max_projects) parts.push(`${role.max_projects} proj`);
  return parts.join(', ');
}

export function RolesPage() {
  const { t } = useTranslation(['system', 'common']);
  usePageTitle(t('system:roles.title'));
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);

  // Form state
  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleColor, setRoleColor] = useState('#3B82F6');
  const [quotaValues, setQuotaValues] = useState<Record<string, number>>({ ...QUOTA_DEFAULTS });

  const { data, isLoading } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => rolesApi.getAll(),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateRoleInput) => rolesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success(t('system:roles.created'));
      handleCloseDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateRoleInput> }) => rolesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success(t('system:roles.updated'));
      handleCloseDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success(t('system:roles.deleted'));
      setDeleteRoleId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleCloseDialog() {
    setCreateOpen(false);
    setEditRole(null);
    setRoleName('');
    setRoleDescription('');
    setRoleColor('#3B82F6');
    setQuotaValues({ ...QUOTA_DEFAULTS });
  }

  function handleOpenEdit(role: Role) {
    setEditRole(role);
    setRoleName(role.name);
    setRoleDescription(role.description ?? '');
    setRoleColor(role.color ?? '#3B82F6');
    const qv: Record<string, number> = {};
    for (const key of Object.keys(QUOTA_DEFAULTS)) {
      qv[key] = (role as unknown as Record<string, number>)[key] ?? QUOTA_DEFAULTS[key];
    }
    setQuotaValues(qv);
    setCreateOpen(true);
  }

  function handleSave() {
    const data: CreateRoleInput = {
      name: roleName,
      color: roleColor,
      description: roleDescription || undefined,
      ...quotaValues,
    };
    if (editRole) {
      updateMutation.mutate({ id: editRole.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const roles = data?.roles ?? [];
  const deleteRole = deleteRoleId ? roles.find(r => r.id === deleteRoleId) : null;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('system:roles.title')}</h1>
        <Button onClick={() => { handleCloseDialog(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />{t('system:roles.createRole')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShieldCheck className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('system:roles.noRoles')}</h2>
          <p className="text-muted-foreground mb-4">{t('system:roles.noRolesDesc')}</p>
          <Button onClick={() => { handleCloseDialog(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('system:roles.createRole')}
          </Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('system:roles.headers.name')}</TableHead>
                <TableHead>{t('system:roles.headers.users')}</TableHead>
                <TableHead>{t('system:roles.headers.quotas')}</TableHead>
                <TableHead>{t('system:roles.headers.created')}</TableHead>
                <TableHead className="w-24">{t('common:actions.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: role.color || '#6B7280' }}
                      />
                      <div>
                        <div className="font-medium">{role.name}</div>
                        {role.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{role.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {role.users_count ?? 0} {t('system:roles.usersCount')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {formatQuotaSummary(role)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(role.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(role)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteRoleId(role.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => !o && handleCloseDialog()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editRole ? t('system:roles.editRole') : t('system:roles.createRole')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('system:roles.roleName')}</Label>
                <Input
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder={t('system:roles.roleNamePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('system:roles.description')}</Label>
                <Textarea
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  placeholder={t('system:roles.descriptionPlaceholder')}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('system:roles.color')}</Label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="h-7 w-7 rounded-full border-2 transition-all hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor: roleColor === color ? '#fff' : 'transparent',
                        boxShadow: roleColor === color ? `0 0 0 2px ${color}` : 'none',
                      }}
                      onClick={() => setRoleColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            {/* Quotas */}
            <div className="space-y-5">
              <Label className="text-base font-semibold">{t('system:roles.quotas')}</Label>

              {QUOTA_GROUPS.map((group) => (
                <div key={group.key} className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t(`system:roles.quotaGroups.${group.key}`)}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {group.fields.map((field) => (
                      <div key={field} className="space-y-1">
                        <Label className="text-xs" htmlFor={`q-${field}`}>
                          {t(`system:roles.quotaFields.${field}`)}
                        </Label>
                        <NumberInput
                          id={`q-${field}`}
                          min={0}
                          value={quotaValues[field] ?? 0}
                          onChange={(v) =>
                            setQuotaValues((prev) => ({ ...prev, [field]: v }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={handleCloseDialog}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={handleSave}
              disabled={!roleName || createMutation.isPending || updateMutation.isPending}
            >
              {editRole ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteRoleId}
        onOpenChange={(o) => !o && setDeleteRoleId(null)}
        title={t('system:roles.deleteConfirm.title')}
        description={
          deleteRole && deleteRole.users_count > 0
            ? t('system:roles.deleteWarningUsers', { count: deleteRole.users_count })
            : t('system:roles.deleteConfirm.desc')
        }
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (deleteRoleId) deleteMutation.mutate(deleteRoleId); }}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
