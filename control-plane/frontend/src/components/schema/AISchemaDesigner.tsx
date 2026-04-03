import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2, Pencil, Loader2, Check, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/api/client';
import { schemaApi } from '@/api/schema.api';
import { toast } from 'sonner';

interface AIColumn {
  name: string;
  type: string;
  nullable: boolean;
}

interface AITable {
  name: string;
  columns: AIColumn[];
}

interface AISchemaDesignerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

const PG_TYPES = [
  'uuid', 'text', 'varchar', 'integer', 'bigint', 'boolean',
  'timestamp', 'date', 'numeric', 'jsonb', 'serial', 'real',
];

export function AISchemaDesigner({ open, onOpenChange, projectId }: AISchemaDesignerProps) {
  const { t } = useTranslation(['tables', 'common']);
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState('');
  const [tables, setTables] = useState<AITable[]>([]);
  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [refinePrompt, setRefinePrompt] = useState('');

  const generateMutation = useMutation({
    mutationFn: (text: string) =>
      api.post<{ tables: AITable[] }>(`/projects/${projectId}/ai/schema`, { prompt: text }),
    onSuccess: (data) => {
      setTables(data.tables ?? []);
      if ((data.tables ?? []).length === 0) {
        toast.error(t('tables:aiDesigner.noTablesGenerated'));
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      for (const table of tables) {
        const columns = table.columns.filter(
          (c) => c.name !== 'id' && c.name !== 'created_at' && c.name !== 'updated_at'
        );
        await schemaApi.createTable(projectId, {
          name: table.name,
          columns: columns.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.nullable,
            is_unique: false,
            is_primary: false,
          })),
          add_timestamps: true,
          add_uuid_pk: true,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables', projectId] });
      toast.success(t('tables:aiDesigner.applied', { count: tables.length }));
      setTables([]);
      setPrompt('');
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeTable = (idx: number) => {
    setTables((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateColumn = (tableIdx: number, colIdx: number, field: keyof AIColumn, value: string | boolean) => {
    setTables((prev) => prev.map((t, ti) =>
      ti === tableIdx ? {
        ...t,
        columns: t.columns.map((c, ci) =>
          ci === colIdx ? { ...c, [field]: value } : c
        ),
      } : t
    ));
  };

  const removeColumn = (tableIdx: number, colIdx: number) => {
    setTables((prev) => prev.map((t, ti) =>
      ti === tableIdx ? {
        ...t,
        columns: t.columns.filter((_, ci) => ci !== colIdx),
      } : t
    ));
  };

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    generateMutation.mutate(prompt);
  };

  const handleRefine = () => {
    if (!refinePrompt.trim()) return;
    const combined = `${prompt}\n\nAdditional requirements: ${refinePrompt}`;
    setPrompt(combined);
    generateMutation.mutate(combined);
    setRefinePrompt('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('tables:aiDesigner.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Prompt input */}
          <div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t('tables:aiDesigner.placeholder')}
              className="min-h-[100px] resize-none"
            />
            <div className="flex gap-2 mt-2">
              <Button
                onClick={handleGenerate}
                disabled={generateMutation.isPending || !prompt.trim()}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {generateMutation.isPending
                  ? t('tables:aiDesigner.generating')
                  : t('tables:aiDesigner.generate')
                }
              </Button>
            </div>
          </div>

          {/* Results */}
          {tables.length > 0 && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-3 pr-4">
                {tables.map((table, tableIdx) => (
                  <Card key={tableIdx}>
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm font-mono">{table.name}</CardTitle>
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {table.columns.length} {t('tables:columns_label')}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingTable(editingTable === tableIdx ? null : tableIdx)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeTable(tableIdx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardHeader>

                    {editingTable === tableIdx ? (
                      <CardContent>
                        <div className="space-y-2">
                          {table.columns.map((col, colIdx) => (
                            <div key={colIdx} className="flex items-center gap-2">
                              <Input
                                value={col.name}
                                onChange={(e) => updateColumn(tableIdx, colIdx, 'name', e.target.value)}
                                className="flex-1 text-xs h-8 font-mono"
                              />
                              <Select
                                value={col.type}
                                onValueChange={(v) => updateColumn(tableIdx, colIdx, 'type', v)}
                              >
                                <SelectTrigger className="w-[130px] h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PG_TYPES.map((pt) => (
                                    <SelectItem key={pt} value={pt} className="text-xs">{pt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-1">
                                <Switch
                                  checked={col.nullable}
                                  onCheckedChange={(v) => updateColumn(tableIdx, colIdx, 'nullable', v)}
                                />
                                <span className="text-xs text-muted-foreground">NULL</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => removeColumn(tableIdx, colIdx)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    ) : (
                      <CardContent>
                        <div className="text-xs text-muted-foreground font-mono">
                          {table.columns.map((c) => c.name).join(', ')}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}

                {/* Refine section */}
                <div className="flex gap-2">
                  <Input
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    placeholder={t('tables:aiDesigner.refinePlaceholder')}
                    className="flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
                  />
                  <Button variant="outline" onClick={handleRefine} disabled={!refinePrompt.trim() || generateMutation.isPending}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('tables:aiDesigner.refine')}
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        {tables.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {t('tables:aiDesigner.applyAll')} ({tables.length})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
