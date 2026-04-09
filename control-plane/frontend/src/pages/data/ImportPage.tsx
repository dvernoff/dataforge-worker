import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileJson, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { dataApi } from '@/api/data.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '@/lib/show-error-toast';

type Step = 'upload' | 'preview' | 'importing' | 'done';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
}

export function ImportPage() {
  const { t } = useTranslation('data');
  usePageTitle(t('import.button'));
  const { slug, name: tableName } = useParams<{ slug: string; name: string }>();
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('upload');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [result, setResult] = useState<{ inserted: number; errors: { index: number; error: string }[]; total: number } | null>(null);

  const importMutation = useMutation({
    mutationFn: () => dataApi.import(project!.id, tableName!, records),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] });
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        let parsed: Record<string, unknown>[];
        if (file.name.endsWith('.json')) {
          parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) parsed = [parsed];
        } else {
          parsed = parseCSV(text);
        }

        if (parsed.length === 0) {
          toast.error(t('import.noRecords'));
          return;
        }
        if (parsed.length > 50000) {
          toast.error(t('import.tooMany'));
          return;
        }

        setRecords(parsed);
        setStep('preview');
      } catch (err) {
        toast.error(t('import.parseFailed', { error: (err as Error).message }));
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const input = document.createElement('input');
    input.type = 'file';
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    handleFileSelect({ target: input } as unknown as React.ChangeEvent<HTMLInputElement>);
  }, [handleFileSelect]);

  const previewCols = records.length > 0 ? Object.keys(records[0]) : [];

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('import.title', { table: tableName })}</h1>

      {step === 'upload' && (
        <Card>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">{t('import.dropZone')}</p>
              <p className="text-sm text-muted-foreground mb-4">{t('import.supports')}</p>
              <div className="flex justify-center gap-3">
                <Badge variant="outline"><FileSpreadsheet className="h-3 w-3 mr-1" />CSV</Badge>
                <Badge variant="outline"><FileJson className="h-3 w-3 mr-1" />JSON</Badge>
              </div>
              <input id="file-input" type="file" accept=".csv,.json" className="hidden" onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('import.previewTitle', { count: records.length.toLocaleString(), cols: previewCols.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {previewCols.map((col) => (
                        <TableHead key={col} className="font-mono text-xs whitespace-nowrap">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.slice(0, 10).map((record, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        {previewCols.map((col) => (
                          <TableCell key={col} className="font-mono text-xs max-w-[150px] truncate">
                            {String(record[col] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {records.length > 10 && (
                <p className="text-sm text-muted-foreground mt-2">
                  {t('import.showingRows', { total: records.length.toLocaleString() })}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={() => { setStep('importing'); importMutation.mutate(); }}>
              {t('import.importBtn', { count: records.length.toLocaleString() })}
            </Button>
            <Button variant="outline" onClick={() => { setStep('upload'); setRecords([]); }}>
              {t('import.chooseFile')}
            </Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <Card>
          <CardContent className="text-center py-8">
            <Progress value={undefined} className="mb-4" />
            <p className="text-lg font-medium">{t('import.importing', { count: records.length.toLocaleString() })}</p>
            <p className="text-sm text-muted-foreground">{t('import.mayTake')}</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && (
        <Card>
          <CardContent className="text-center py-8">
            {result.errors.length === 0 ? (
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            ) : (
              <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            )}
            <p className="text-lg font-medium mb-2">
              {t('import.complete')}
            </p>
            <div className="flex justify-center gap-4 mb-6">
              <Badge variant="secondary" className="text-base px-3 py-1">
                {t('import.inserted', { count: result.inserted })}
              </Badge>
              {result.errors.length > 0 && (
                <Badge variant="destructive" className="text-base px-3 py-1">
                  {t('import.errors', { count: result.errors.length })}
                </Badge>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 mb-4 text-left">
                {result.errors.slice(0, 50).map((err, i) => (
                  <p key={i} className="text-xs text-destructive font-mono py-0.5">
                    #{err.index + 1}: {err.error}
                  </p>
                ))}
                {result.errors.length > 50 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    ...{t('import.moreErrors', { count: result.errors.length - 50 })}
                  </p>
                )}
              </div>
            )}
            <Button onClick={() => navigate(`/projects/${slug}/tables/${tableName}/data`)}>
              {t('import.viewData')}
            </Button>
          </CardContent>
        </Card>
      )}
    </PageWrapper>
  );
}
