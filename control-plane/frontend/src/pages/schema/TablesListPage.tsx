import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Table2, LayoutGrid, List, MoreHorizontal, Pencil, Eye, Trash2, History, FileUp, Code } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { staggerContainer, staggerItem, cardHover } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { tableInfoToYaml } from '@/lib/yaml-schema';
import { toast } from 'sonner';
import { showErrorToast } from '@/lib/show-error-toast';
import { CreateTableDialog } from '@/components/schema/CreateTableDialog';
import { getProjectColor } from '@/lib/project-colors';
import { SchemaImportDialog } from '@/components/schema/SchemaImportDialog';
import { usePageTitle } from '@/hooks/usePageTitle';

export function TablesListPage() {
  const { t } = useTranslation(['tables', 'common']);
  usePageTitle(t('tables:pageTitle'));
  const [viewMode, setViewMode] = useState<string>(() => localStorage.getItem('dataforge-tables-view') ?? 'cards');
  const handleViewChange = (mode: string) => { setViewMode(mode); localStorage.setItem('dataforge-tables-view', mode); };
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editYaml, setEditYaml] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project } = useCurrentProject();

  const { data, isLoading } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: (tableName: string) => schemaApi.dropTable(project!.id, tableName),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tables', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['endpoints', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      const cleaned = (res as { cleaned?: string[] })?.cleaned;
      if (cleaned && cleaned.length > 0) {
        toast.success(`${t('tables:tableDeleted')} (${cleaned.join(', ')})`);
      } else {
        toast.success(t('tables:tableDeleted'));
      }
      setDeleteTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const tables = data?.tables ?? [];
  const basePath = `/projects/${project?.slug}`;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('tables:pageTitle')}</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border">
            <Toggle
              pressed={viewMode === 'cards'}
              onPressedChange={() => handleViewChange('cards')}
              aria-label={t('tables:cardView')}
              className="rounded-r-none border-0"
            >
              <LayoutGrid className="h-4 w-4" />
            </Toggle>
            <Toggle
              pressed={viewMode === 'list'}
              onPressedChange={() => handleViewChange('list')}
              aria-label={t('tables:listView')}
              className="rounded-l-none border-0"
            >
              <List className="h-4 w-4" />
            </Toggle>
          </div>
          <Button variant="outline" onClick={() => navigate(`${basePath}/tables/history`)}>
            <History className="h-4 w-4 mr-2" />
            {t('tables:versioning.title')}
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4 mr-2" />
            {t('tables:importSchema')}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('tables:createTable')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Table2 className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('tables:noTables')}</h2>
          <p className="text-muted-foreground mb-4">{t('tables:noTablesDesc')}</p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('tables:createTable')}
          </Button>
        </div>
      ) : viewMode === 'cards' ? (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {tables.map((table) => (
            <motion.div key={table.name} variants={staggerItem} {...cardHover}>
              <Card
                className="h-full cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`${basePath}/tables/${table.name}/data`)}
              >
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-8 w-8 rounded-md flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: getProjectColor(table.name) }}
                    >
                      {table.name.charAt(0).toUpperCase()}
                    </div>
                    <CardTitle className="text-base font-mono">{table.name}</CardTitle>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/tables/${table.name}/data`); }}>
                        <Pencil className="h-4 w-4 mr-2" />
                        {t('tables:editSchema')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={async (e) => {
                        e.stopPropagation();
                        const { table: info } = await schemaApi.getTable(project!.id, table.name);
                        setEditYaml(tableInfoToYaml([info]));
                        setImportOpen(true);
                      }}>
                        <Code className="h-4 w-4 mr-2" />
                        {t('tables:editYaml')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/tables/${table.name}/data`); }}>
                        <Eye className="h-4 w-4 mr-2" />
                        {t('tables:viewData')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(table.name); }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('common:actions.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3">
                    <Badge variant="secondary">{table.column_count} {t('tables:columns_label')}</Badge>
                    <Badge variant="secondary">{table.row_count.toLocaleString()} {t('tables:rows')}</Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tables:headers.name')}</TableHead>
                <TableHead>{t('tables:headers.columns')}</TableHead>
                <TableHead>{t('tables:headers.rows')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((table) => (
                <TableRow
                  key={table.name}
                  className="cursor-pointer"
                  onClick={() => navigate(`${basePath}/tables/${table.name}/data`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center text-white font-bold text-[10px] shrink-0"
                        style={{ backgroundColor: getProjectColor(table.name) }}
                      >
                        {table.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-mono font-medium">{table.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>{table.column_count}</TableCell>
                  <TableCell>{table.row_count.toLocaleString()}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/tables/${table.name}/data`); }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          {t('tables:editSchema')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={async (e) => {
                          e.stopPropagation();
                          const { table: info } = await schemaApi.getTable(project!.id, table.name);
                          setEditYaml(tableInfoToYaml([info]));
                          setImportOpen(true);
                        }}>
                          <Code className="h-4 w-4 mr-2" />
                          {t('tables:editYaml')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/tables/${table.name}/data`); }}>
                          <Eye className="h-4 w-4 mr-2" />
                          {t('tables:viewData')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(table.name); }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('common:actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateTableDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project?.id ?? ''}
      />

      <SchemaImportDialog
        open={importOpen}
        onOpenChange={(o) => { setImportOpen(o); if (!o) setEditYaml(undefined); }}
        projectId={project?.id ?? ''}
        initialYaml={editYaml}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('tables:deleteTable.title')}
        description={t('tables:deleteTable.desc', { name: deleteTarget })}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />

    </PageWrapper>
  );
}
