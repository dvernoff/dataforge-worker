import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Database, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { staggerContainer, staggerItem, cardHover } from '@/lib/animations';

export function DataBrowserIndexPage() {
  const { t } = useTranslation('data');
  usePageTitle(t('pageTitle'));
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();

  const { data, isLoading } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const tables = data?.tables ?? [];
  const basePath = `/projects/${project?.slug}`;

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('pageTitle')}</h1>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Database className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('noRecords')}</h2>
          <p className="text-muted-foreground">{t('noRecordsDesc')}</p>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {tables.map((tbl) => (
            <motion.div key={tbl.name} variants={staggerItem} {...cardHover}>
              <Card
                className="h-full cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`${basePath}/tables/${tbl.name}/data`)}
              >
                <CardHeader className="flex flex-row items-start justify-between">
                  <CardTitle className="text-base font-mono">{tbl.name}</CardTitle>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardHeader>
                <CardContent>
                  <div className="flex gap-3">
                    <Badge variant="secondary">{tbl.column_count} {t('columns', 'col')}</Badge>
                    <Badge variant="secondary">{tbl.row_count.toLocaleString()} {t('records')}</Badge>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}
    </PageWrapper>
  );
}
