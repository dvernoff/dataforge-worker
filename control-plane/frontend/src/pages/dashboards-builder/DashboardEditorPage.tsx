import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, Trash2, ArrowLeft, GripVertical, Hash, BarChart3, Table2, FileText, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { dashboardsApi, type Dashboard, type Widget } from '@/api/dashboards.api';
import { toast } from 'sonner';

const WIDGET_ICONS: Record<string, typeof Hash> = {
  number: Hash,
  chart: BarChart3,
  table: Table2,
  text: FileText,
};

const CHART_COLORS = [
  'hsl(142, 71%, 45%)',
  'hsl(217, 91%, 60%)',
  'hsl(38, 92%, 50%)',
  'hsl(0, 84%, 60%)',
  'hsl(280, 65%, 60%)',
  'hsl(180, 70%, 45%)',
  'hsl(330, 80%, 55%)',
  'hsl(60, 80%, 50%)',
];

export function DashboardEditorPage() {
  const { t } = useTranslation(['dashboards', 'common']);
  const { id: dashboardId, slug } = useParams<{ id: string; slug: string }>();
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<Widget | null>(null);
  const [widgetResults, setWidgetResults] = useState<Record<string, Record<string, unknown>>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [wType, setWType] = useState<Widget['type']>('number');
  const [wTitle, setWTitle] = useState('');
  const [wSql, setWSql] = useState('');
  const [wContent, setWContent] = useState('');

  usePageTitle(name || t('dashboards:editor'));

  const { data } = useQuery({
    queryKey: ['dashboard', project?.id, dashboardId],
    queryFn: () => dashboardsApi.getById(project!.id, dashboardId!),
    enabled: !!project?.id && !!dashboardId,
  });

  const hasLoaded = useRef(false);

  useEffect(() => {
    if (data?.dashboard) {
      setWidgets(data.dashboard.widgets ?? []);
      setName(data.dashboard.name);
      setIsPublic(data.dashboard.is_public ?? false);
      if (!hasLoaded.current && (data.dashboard.widgets ?? []).length > 0) {
        hasLoaded.current = true;
        setTimeout(() => executeMutation.mutate(), 100);
      }
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => dashboardsApi.update(project!.id, dashboardId!, {
      name,
      widgets,
      is_public: isPublic,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', project?.id, dashboardId] });
      queryClient.invalidateQueries({ queryKey: ['dashboards', project?.id] });
      toast.success(t('dashboards:saved'));
      setPreviewMode(true);
      executeMutation.mutate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const executeMutation = useMutation({
    mutationFn: () => dashboardsApi.execute(project!.id, dashboardId!),
    onSuccess: (data) => {
      setWidgetResults(data.results);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openAddDialog = () => {
    setEditWidget(null);
    setWType('number');
    setWTitle('');
    setWSql('');
    setWContent('');
    setAddDialogOpen(true);
  };

  const openEditDialog = (w: Widget) => {
    setEditWidget(w);
    setWType(w.type);
    setWTitle(w.title);
    setWSql(w.sql ?? '');
    setWContent(w.content ?? '');
    setAddDialogOpen(true);
  };

  const autoSave = (updatedWidgets: Widget[]) => {
    if (!project?.id || !dashboardId) return;
    dashboardsApi.update(project.id, dashboardId, { name, widgets: updatedWidgets, is_public: isPublic })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboard', project?.id, dashboardId] });
        queryClient.invalidateQueries({ queryKey: ['dashboards', project?.id] });
        executeMutation.mutate();
      })
      .catch((err: Error) => toast.error(err.message));
  };

  const handleSaveWidget = () => {
    const widget: Widget = {
      id: editWidget?.id ?? crypto.randomUUID(),
      type: wType,
      title: wTitle,
      sql: wType !== 'text' ? wSql : undefined,
      content: wType === 'text' ? wContent : undefined,
    };

    let updated: Widget[];
    if (editWidget) {
      updated = widgets.map((w) => w.id === editWidget.id ? widget : w);
    } else {
      updated = [...widgets, widget];
    }
    setWidgets(updated);
    setAddDialogOpen(false);
    autoSave(updated);
  };

  const deleteWidget = (id: string) => {
    const updated = widgets.filter((w) => w.id !== id);
    setWidgets(updated);
    autoSave(updated);
  };

  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const updated = [...widgets];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setWidgets(updated);
    setDragIdx(null);
    setDragOverIdx(null);
    autoSave(updated);
  };

  const renderWidgetContent = (widget: Widget) => {
    const result = widgetResults[widget.id];

    if (widget.type === 'text') {
      return <p className="text-sm whitespace-pre-wrap">{widget.content}</p>;
    }

    if (!result) {
      return <p className="text-sm text-muted-foreground">{t('dashboards:runToSeeData')}</p>;
    }

    if (result.error) {
      return <p className="text-sm text-destructive">{String(result.error)}</p>;
    }

    const rows = (result.rows as Record<string, unknown>[]) ?? [];
    const fields = (result.fields as string[]) ?? [];

    if (widget.type === 'number') {
      const value = rows[0] ? Object.values(rows[0])[0] : '-';
      return <p className="text-3xl font-bold">{String(value)}</p>;
    }

    if (widget.type === 'chart') {
      if (rows.length === 0) {
        return <p className="text-sm text-muted-foreground">{t('dashboards:noData')}</p>;
      }
      const keys = Object.keys(rows[0]);
      const labelKey = keys[0];
      const valueKey = keys[1] ?? keys[0];
      const maxVal = Math.max(...rows.map((r) => Number(r[valueKey] ?? 0)), 1);
      const total = rows.reduce((sum, r) => sum + Number(r[valueKey] ?? 0), 0);

      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{labelKey}</span>
            <span>{t('dashboards:total')}: {total.toLocaleString()}</span>
          </div>
          {rows.slice(0, 10).map((row, i) => {
            const label = String(row[labelKey] ?? '');
            const val = Number(row[valueKey] ?? 0);
            const pct = (val / maxVal) * 100;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate mr-2">{label}</span>
                  <span className="font-medium shrink-0">{val.toLocaleString()}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="overflow-auto max-h-[250px]">
        <Table>
          <TableHeader>
            <TableRow>
              {fields.map((f) => (
                <TableHead key={f} className="text-xs">{f}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 50).map((row, i) => (
              <TableRow key={i}>
                {fields.map((f) => (
                  <TableCell key={f} className="text-xs">{row[f] === null ? 'NULL' : String(row[f])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${slug}/dashboards`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {previewMode ? (
            <h1 className="text-lg font-bold">{name}</h1>
          ) : (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name && project?.id && dashboardId) dashboardsApi.update(project.id, dashboardId, { name }).catch(() => {}); }}
              className="text-lg font-bold border-none bg-transparent px-0 focus-visible:ring-0 w-auto"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {previewMode ? (
            <Button variant="outline" size="sm" onClick={() => setPreviewMode(false)}>
              <Pencil className="h-4 w-4 mr-1" />
              {t('dashboards:editMode')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => { setPreviewMode(true); executeMutation.mutate(); }}>
              <Eye className="h-4 w-4 mr-1" />
              {t('dashboards:previewMode')}
            </Button>
          )}
        </div>
      </div>

      {!previewMode && (
        <Button variant="outline" className="mb-4" onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-1" />
          {t('dashboards:addWidget')}
        </Button>
      )}

      <div className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {widgets.map((widget, idx) => {
          const Icon = WIDGET_ICONS[widget.type] ?? Hash;
          const isDragOver = dragOverIdx === idx && dragIdx !== idx;
          return (
            <div
              key={widget.id}
              draggable={!previewMode}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onDrop={() => handleDrop(idx)}
              className={isDragOver ? 'ring-2 ring-primary rounded-lg' : ''}
            >
              <Card className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      {!previewMode && (
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100 shrink-0" />
                      )}
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {widget.title}
                    </CardTitle>
                    {!previewMode && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog(widget)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteWidget(widget.id)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {renderWidgetContent(widget)}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      {widgets.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{t('dashboards:noWidgets')}</p>
        </div>
      )}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editWidget ? t('dashboards:editWidget') : t('dashboards:addWidget')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('dashboards:widgetType')}</Label>
              <Select value={wType} onValueChange={(v) => setWType(v as Widget['type'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">{t('dashboards:types.number')}</SelectItem>
                  <SelectItem value="chart">{t('dashboards:types.chart')}</SelectItem>
                  <SelectItem value="table">{t('dashboards:types.table')}</SelectItem>
                  <SelectItem value="text">{t('dashboards:types.text')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('dashboards:widgetTitle')}</Label>
              <Input value={wTitle} onChange={(e) => setWTitle(e.target.value)} placeholder={t('dashboards:widgetTitlePlaceholder')} />
            </div>
            {wType === 'text' ? (
              <div className="space-y-2">
                <Label>{t('dashboards:textContent')}</Label>
                <Textarea value={wContent} onChange={(e) => setWContent(e.target.value)} placeholder={t('dashboards:textPlaceholder')} rows={4} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>{t('dashboards:sqlQuery')}</Label>
                <Textarea value={wSql} onChange={(e) => setWSql(e.target.value)} placeholder={wType === 'number' ? 'SELECT COUNT(*) FROM users' : wType === 'chart' ? 'SELECT status, COUNT(*) as count FROM orders GROUP BY status' : 'SELECT * FROM users LIMIT 10'} className="font-mono text-xs" rows={4} />
                <p className="text-[11px] text-muted-foreground">
                  {wType === 'number' && t('dashboards:hints.number')}
                  {wType === 'chart' && t('dashboards:hints.chart')}
                  {wType === 'table' && t('dashboards:hints.table')}
                </p>
              </div>
            )}
            <Button onClick={handleSaveWidget} disabled={!wTitle} className="w-full">
              {editWidget ? t('common:actions.save') : t('common:actions.add')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
