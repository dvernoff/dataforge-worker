import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, FolderKanban, Cpu, HardDrive, Server, Star, AlertTriangle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { staggerContainer, staggerItem, cardHover } from '@/lib/animations';
import { useProjects } from '@/hooks/useProject';
import { projectsApi } from '@/api/projects.api';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { usePageTitle } from '@/hooks/usePageTitle';

interface NodeStatus {
  id: string;
  name: string;
  slug: string;
  url: string;
  region: string;
  status: string;
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  max_projects: number;
  projects_count: number;
  last_heartbeat: string;
  ping?: number;
}

const TRANSLIT_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const createSchema = z.object({
  name: z.string().min(1, 'Name required').max(255),
  slug: z.string().min(4, 'Minimum 4 characters').max(255).regex(/^[a-z0-9-]+$/, 'Lowercase, numbers, dashes only'),
  description: z.string().max(1000).optional(),
});

type CreateForm = z.infer<typeof createSchema>;

export function ProjectsListPage() {
  const { t } = useTranslation();
  usePageTitle(t('projects.title'));
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useProjects();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodePings, setNodePings] = useState<Record<string, number>>({});

  const { data: nodesData, isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes', 'status'],
    queryFn: () => api.get<{ nodes: NodeStatus[] }>('/nodes/status'),
    enabled: dialogOpen,
  });

  const hasNodes = !!(nodesData?.nodes?.length);
  const canCreate = hasNodes && !!selectedNodeId;

  // Measure ping to each node when dialog opens
  const measurePings = useCallback(async (nodes: NodeStatus[]) => {
    const pings: Record<string, number> = {};
    for (const node of nodes) {
      try {
        const start = performance.now();
        await fetch(node.url + '/api/health', { mode: 'no-cors', signal: AbortSignal.timeout(5000) });
        pings[node.id] = Math.round(performance.now() - start);
      } catch {
        pings[node.id] = 9999;
      }
    }
    setNodePings(pings);
    // Auto-select the node with lowest ping
    const bestNode = nodes.reduce((best, n) =>
      (pings[n.id] ?? 9999) < (pings[best.id] ?? 9999) ? n : best, nodes[0]);
    if (bestNode && !selectedNodeId) setSelectedNodeId(bestNode.id);
  }, [selectedNodeId]);

  useEffect(() => {
    if (nodesData?.nodes?.length) {
      measurePings(nodesData.nodes);
    }
  }, [nodesData, measurePings]);

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', slug: '', description: '' },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) => projectsApi.create({ ...data, node_id: selectedNodeId! }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDialogOpen(false);
      form.reset();
      toast.success(t('projects.created'));
      navigate(`/projects/${data.project.slug}/dashboard`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('projects.title')}</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('projects.newProject')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('projects.createProject')}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('projects.form.name')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('projects.form.namePlaceholder')}
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            if (!form.getFieldState('slug').isDirty) {
                              form.setValue('slug', transliterate(e.target.value.trim()));
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('projects.form.slug')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('projects.form.slugPlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('projects.form.description')}</FormLabel>
                      <FormControl>
                        <Textarea placeholder={t('projects.form.descriptionPlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Node Selector */}
                <div className="space-y-2">
                  <FormLabel>{t('projects.nodeSelect.title')}</FormLabel>

                  {nodesLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-24 w-full rounded-lg" />
                      <Skeleton className="h-24 w-full rounded-lg" />
                    </div>
                  ) : !hasNodes ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-destructive">{t('projects.nodeSelect.noNodes')}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t('projects.nodeSelect.noNodesDesc')}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {nodesData!.nodes.map((node) => {
                        const ping = nodePings[node.id];
                        const isRecommended = ping !== undefined &&
                          Object.values(nodePings).length === nodesData!.nodes.length &&
                          ping === Math.min(...Object.values(nodePings));
                        const isSelected = selectedNodeId === node.id;
                        return (
                          <div
                            key={node.id}
                            className={`relative p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-primary/40'
                            }`}
                            onClick={() => setSelectedNodeId(node.id)}
                          >
                            {isRecommended && (
                              <Badge className="absolute top-2 right-2 text-[10px]" variant="default">
                                <Star className="h-3 w-3 mr-0.5" />
                                {t('projects.nodeSelect.recommended')}
                              </Badge>
                            )}
                            <div className="flex items-center gap-2 mb-2">
                              <Server className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium text-sm">{node.name}</span>
                              <span className="text-xs text-muted-foreground">{node.region}</span>
                              {ping !== undefined && ping < 9999 && (
                                <span className="text-xs text-muted-foreground ml-auto">{ping}ms</span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">{t('projects.nodeSelect.cpu')}</span>
                                  <span>{Math.round(node.cpu_usage)}%</span>
                                </div>
                                <Progress value={node.cpu_usage} className="h-1" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">{t('projects.nodeSelect.ram')}</span>
                                  <span>{Math.round(node.ram_usage)}%</span>
                                </div>
                                <Progress value={node.ram_usage} className="h-1" />
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">{t('projects.nodeSelect.disk')}</span>
                                  <span>{Math.round(node.disk_usage)}%</span>
                                </div>
                                <Progress value={node.disk_usage} className="h-1" />
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {t('projects.nodeSelect.projectsCount', { count: node.projects_count, max: node.max_projects })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending || !canCreate}>
                  {createMutation.isPending ? t('actions.creating') : t('projects.createProject')}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        >
          {projects.map((project) => (
            <motion.div key={project.id} variants={staggerItem} {...cardHover}>
              <Card
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/projects/${project.slug}/dashboard`)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  <CardDescription>{project.description ?? t('projects.noDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {t('projects.createdDate', { date: new Date(project.created_at).toLocaleDateString() })}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('projects.noProjects')}</h2>
          <p className="text-muted-foreground mb-4">{t('projects.noProjectsDesc')}</p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('projects.newProject')}
          </Button>
        </div>
      )}
    </PageWrapper>
  );
}
