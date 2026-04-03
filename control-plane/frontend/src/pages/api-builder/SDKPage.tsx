import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';

const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript', ext: '.ts' },
  { id: 'python', label: 'Python', ext: '.py' },
  { id: 'curl', label: 'cURL', ext: '.sh' },
] as const;

type Language = typeof LANGUAGES[number]['id'];

export function SDKPage() {
  const { t } = useTranslation(['common']);
  usePageTitle(t('common:nav.sdk'));
  const { data: project } = useCurrentProject();
  const [language, setLanguage] = useState<Language>('typescript');
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['sdk', project?.id, language],
    queryFn: () =>
      api.get<{ code: string; language: string; project_slug: string }>(
        `/projects/${project!.id}/sdk/${language}`
      ),
    enabled: !!project?.id,
  });

  const handleCopy = async () => {
    if (!data?.code) return;
    await navigator.clipboard.writeText(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!data?.code) return;
    const langInfo = LANGUAGES.find((l) => l.id === language);
    const filename = `dataforge-sdk${langInfo?.ext ?? '.txt'}`;
    const blob = new Blob([data.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('common:nav.sdk')}</h1>
      </div>

      <Tabs value={language} onValueChange={(v) => setLanguage(v as Language)}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            {LANGUAGES.map((lang) => (
              <TabsTrigger key={lang.id} value={lang.id}>
                {lang.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data?.code}>
              {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
              {copied ? t('common:actions.copied') : t('common:actions.copy')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!data?.code}>
              <Download className="h-3 w-3 mr-1" />
              {t('common:actions.export')}
            </Button>
          </div>
        </div>

        {LANGUAGES.map((lang) => (
          <TabsContent key={lang.id} value={lang.id}>
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <Skeleton key={i} className="h-4" style={{ width: `${60 + Math.random() * 40}%` }} />
                    ))}
                  </div>
                ) : data?.code ? (
                  <pre className="p-4 text-sm font-mono overflow-auto max-h-[600px] whitespace-pre-wrap">
                    {data.code}
                  </pre>
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    {t('common:actions.noData')}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </PageWrapper>
  );
}
