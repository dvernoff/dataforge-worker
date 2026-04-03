import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { dataApi } from '@/api/data.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '@/lib/show-error-toast';

const AUTO_FIELDS = new Set(['id', 'created_at', 'updated_at']);

export function RecordFormPage() {
  const { t } = useTranslation(['data', 'common']);
  usePageTitle(t('record.new'));
  const { slug, name: tableName, id: recordId } = useParams<{ slug: string; name: string; id?: string }>();
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const isEdit = !!recordId && recordId !== 'new';

  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Table schema
  const { data: tableData, isLoading: schemaLoading } = useQuery({
    queryKey: ['table', project?.id, tableName],
    queryFn: () => schemaApi.getTable(project!.id, tableName!),
    enabled: !!project?.id && !!tableName,
  });

  // Existing record (edit mode)
  const { data: recordData, isLoading: recordLoading } = useQuery({
    queryKey: ['record', project?.id, tableName, recordId],
    queryFn: () => dataApi.getById(project!.id, tableName!, recordId!),
    enabled: isEdit && !!project?.id,
  });

  useEffect(() => {
    if (isEdit && recordData?.record) {
      setFormData(recordData.record);
    }
  }, [isEdit, recordData]);

  const columns = tableData?.table.columns.filter((c) => !AUTO_FIELDS.has(c.name)) ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        return dataApi.update(project!.id, tableName!, recordId!, formData);
      }
      return dataApi.create(project!.id, tableName!, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] });
      toast.success(isEdit ? t('record.saved') : t('record.created'));
      navigate(`/projects/${slug}/tables/${tableName}/data`);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  function updateField(name: string, value: unknown) {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function renderField(col: { name: string; type: string; nullable: boolean }) {
    const value = formData[col.name];

    if (col.type === 'boolean') {
      return (
        <Switch
          checked={!!value}
          onCheckedChange={(v) => updateField(col.name, v)}
        />
      );
    }

    if (col.type === 'json' || col.type === 'jsonb') {
      return (
        <Textarea
          value={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}
          onChange={(e) => {
            try {
              updateField(col.name, JSON.parse(e.target.value));
            } catch {
              updateField(col.name, e.target.value);
            }
          }}
          className="font-mono min-h-[100px]"
          placeholder="{}"
        />
      );
    }

    if (col.type === 'text' && !col.name.includes('id')) {
      return (
        <Textarea
          value={String(value ?? '')}
          onChange={(e) => updateField(col.name, e.target.value || (col.nullable ? null : ''))}
          placeholder={col.nullable ? 'NULL' : ''}
        />
      );
    }

    return (
      <Input
        type={['integer', 'bigint', 'float', 'decimal'].includes(col.type) ? 'number' : 'text'}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          if (!v && col.nullable) {
            updateField(col.name, null);
          } else if (['integer', 'bigint'].includes(col.type)) {
            updateField(col.name, v ? parseInt(v, 10) : null);
          } else if (['float', 'decimal'].includes(col.type)) {
            updateField(col.name, v ? parseFloat(v) : null);
          } else {
            updateField(col.name, v);
          }
        }}
        placeholder={col.nullable ? 'NULL' : ''}
        className="font-mono"
      />
    );
  }

  if (schemaLoading || (isEdit && recordLoading)) {
    return (
      <PageWrapper>
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-96" />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">
        {isEdit ? t('record.edit') : t('record.new')}
      </h1>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {columns.map((col) => (
              <div key={col.name} className={col.type === 'jsonb' || col.type === 'json' || col.type === 'text' ? 'md:col-span-2' : ''}>
                <Label className="font-mono text-sm">
                  {col.name}
                  {!col.nullable && <span className="text-destructive ml-1">*</span>}
                  <span className="ml-2 text-muted-foreground font-normal">{col.type}</span>
                </Label>
                <div className="mt-1">
                  {renderField(col)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t sticky bottom-0 bg-card">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('record.saving') : t('record.save')}
            </Button>
            <Button variant="outline" onClick={() => navigate(-1)}>
              {t('common:actions.cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageWrapper>
  );
}
