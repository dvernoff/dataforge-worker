import { useMutation } from '@tanstack/react-query';
import { Sparkles, Loader2, AlertTriangle, Search, Database, Hash, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { api } from '@/api/client';

interface Analysis {
  category: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  suggestion: string;
  affectedColumns: string[];
}

interface AnalysisResult {
  analyses: Analysis[];
  tableName: string;
  totalRows: number;
  estimated_tokens: number;
}

interface AIDataAnalyzerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tableName: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  duplicates: <Search className="h-4 w-4" />,
  outliers: <AlertTriangle className="h-4 w-4" />,
  missing_indexes: <Database className="h-4 w-4" />,
  null_analysis: <Hash className="h-4 w-4" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-600 border-green-500/30',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  high: 'bg-red-500/10 text-red-600 border-red-500/30',
};

export function AIDataAnalyzer({ open, onOpenChange, projectId, tableName }: AIDataAnalyzerProps) {
  const { t } = useTranslation(['data', 'common']);

  const analyzeMutation = useMutation({
    mutationFn: () =>
      api.post<AnalysisResult>(`/projects/${projectId}/tables/${tableName}/ai/analyze`),
  });

  const handleAnalyze = () => {
    analyzeMutation.mutate();
  };

  const analyses = analyzeMutation.data?.analyses ?? [];

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      duplicates: t('data:aiAnalyzer.duplicates'),
      outliers: t('data:aiAnalyzer.outliers'),
      missing_indexes: t('data:aiAnalyzer.missingIndexes'),
      null_analysis: t('data:aiAnalyzer.nullAnalysis'),
    };
    return labels[category] ?? category;
  };

  const getSeverityLabel = (severity: string) => {
    const labels: Record<string, string> = {
      low: t('data:aiAnalyzer.severityLow'),
      medium: t('data:aiAnalyzer.severityMedium'),
      high: t('data:aiAnalyzer.severityHigh'),
    };
    return labels[severity] ?? severity;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[450px] sm:w-[500px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('data:aiAnalyzer.title')}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {!analyzeMutation.data && !analyzeMutation.isPending && (
            <div className="text-center py-8">
              <Sparkles className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('data:aiAnalyzer.description', { table: tableName })}
              </p>
              <Button onClick={handleAnalyze}>
                <Sparkles className="h-4 w-4 mr-2" />
                {t('data:aiAnalyzer.analyze')}
              </Button>
            </div>
          )}

          {analyzeMutation.isPending && (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-sm text-muted-foreground">
                {t('data:aiAnalyzer.analyzing')}
              </p>
            </div>
          )}

          {analyzeMutation.isError && (
            <div className="text-center py-8">
              <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
              <p className="text-sm text-destructive mb-4">
                {(analyzeMutation.error as Error).message}
              </p>
              <Button variant="outline" onClick={handleAnalyze}>
                {t('common:actions.refresh')}
              </Button>
            </div>
          )}

          {analyses.length > 0 && (
            <ScrollArea className="h-[calc(100vh-180px)]">
              <div className="space-y-3 pr-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {analyses.length} {t('data:aiAnalyzer.findings')}
                  </p>
                  <Button variant="ghost" size="sm" onClick={handleAnalyze} disabled={analyzeMutation.isPending}>
                    {t('common:actions.refresh')}
                  </Button>
                </div>

                {analyses.map((analysis, i) => (
                  <Card key={i}>
                    <CardHeader className="py-3 px-4 flex flex-row items-start gap-3">
                      <div className="mt-0.5 text-muted-foreground">
                        {CATEGORY_ICONS[analysis.category] ?? <Search className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CardTitle className="text-sm">{analysis.title}</CardTitle>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${SEVERITY_COLORS[analysis.severity] ?? ''}`}
                          >
                            {getSeverityLabel(analysis.severity)}
                          </Badge>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {getCategoryLabel(analysis.category)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 px-4 pb-3">
                      <p className="text-xs text-muted-foreground mb-2">{analysis.description}</p>
                      {analysis.suggestion && (
                        <div className="bg-muted rounded-md p-2">
                          <p className="text-xs font-medium mb-0.5">{t('data:aiAnalyzer.suggestion')}:</p>
                          <p className="text-xs text-muted-foreground">{analysis.suggestion}</p>
                        </div>
                      )}
                      {analysis.affectedColumns && analysis.affectedColumns.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {analysis.affectedColumns.map((col) => (
                            <Badge key={col} variant="outline" className="text-[10px] font-mono">
                              {col}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
