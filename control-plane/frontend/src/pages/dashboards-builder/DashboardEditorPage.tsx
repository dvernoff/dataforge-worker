import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Eye, EyeOff, Trash2, ArrowLeft, Share2, Hash, BarChart3, Table2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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

export function DashboardEditorPage() {
  const { t } = useTranslation(['dashboards', 'common']);
  const { id: dashboardId, slug } = useParams<{ id: string; slug: string }>();
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<Widget | null>(null);
  const [widgetResults, setWidgetResults] = useState<Record<string, Record<string, unknown>>>({});

  // Widget form
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

  useEffect(() => {
    if (data?.dashboard) {
      setWidgets(data.dashboard.widgets ?? []);
      setName(data.dashboard.name);
      setIsPublic(data.dashboard.is_public ?? false);
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
      toast.success(t('dashboards:saved'));
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

  const handleSaveWidget = () => {
    const widget: Widget = {
      id: editWidget?.id ?? crypto.randomUUID(),
      type: wType,
      title: wTitle,
      sql: wType !== 'text' ? wSql : undefined,
      content: wType === 'text' ? wContent : undefined,
    };

    if (editWidget) {
      setWidgets(widgets.map((w) => w.id === editWidget.id ? widget : w));
    } else {
      setWidgets([...widgets, widget]);
    }
    setAddDialogOpen(false);
  };

  const deleteWidget = (id: string) => {
    setWidgets(widgets.filter((w) => w.id !== id));
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
      // Simple bar representation
      return (
        <div className="space-y-1">
          {rows.slice(0, 10).map((row, i) => {
            const label = String(Object.values(row)[0] ?? '');
            const val = Number(Object.values(row)[1] ?? 0);
            const maxVal = Math.max(...rows.map((r) => Number(Object.values(r)[1] ?? 0)));
            const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-muted-foreground">{label}</span>
                <div className="flex-1 bg-muted rounded-full h-4">
                  <div className="bg-primary h-4 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-12 text-right">{val}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // table type
    return (
      <div className="overflow-auto max-h-[200px]">
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
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-lg font-bold border-none bg-transparent px-0 focus-visible:ring-0 w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            <Label className="text-sm">{t('dashboards:public')}</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setPreviewMode(!previewMode); if (!previewMode) executeMutation.mutate(); }}>
            {previewMode ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {previewMode ? t('dashboards:editMode') : t('dashboards:previewMode')}
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? t('common:actions.saving') : t('common:actions.save')}
          </Button>
        </div>
      </div>

      {!previewMode && (
        <Button variant="outline" className="mb-4" onClick={openAddDialog}>
          <Plus className="h-4 w-4 mr-1" />
          {t('dashboards:addWidget')}
        </Button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {widgets.map((widget) => {
          const Icon = WIDGET_ICONS[widget.type] ?? Hash;
          return (
            <Card key={widget.id} className="relative group">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {widget.title}
                  </CardTitle>
                  {!previewMode && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog(widget)}>
                        <FileText className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteWidget(widget.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px] w-fit">{widget.type}</Badge>
              </CardHeader>
              <CardContent>
                {renderWidgetContent(widget)}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {widgets.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>{t('dashboards:noWidgets')}</p>
        </div>
      )}

      {/* Add/Edit Widget Dialog */}
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
                  {t(`dashboards:types.${wType}`)}
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
                <Textarea value={wSql} onChange={(e) => setWSql(e.target.value)} placeholder="SELECT COUNT(*) FROM ..." className="font-mono text-xs" rows={4} />
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
