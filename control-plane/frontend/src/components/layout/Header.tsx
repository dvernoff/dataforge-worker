import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Search } from 'lucide-react';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjects } from '@/hooks/useProject';
import { useUIStore } from '@/stores/ui.store';

export function Header() {
  const { t } = useTranslation();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const { data: projects } = useProjects();
  const { setCommandPaletteOpen } = useUIStore();

  const projectName = useMemo(() => {
    if (!slug || !projects) return slug;
    return projects.find((p) => p.slug === slug)?.name ?? slug;
  }, [slug, projects]);

  const breadcrumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const items: { label: string; href?: string }[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === 'projects' && parts[i + 1]) {
        items.push({ label: projectName ?? parts[i + 1], href: `/projects/${parts[i + 1]}/dashboard` });
        i++;
        continue;
      }
      if (part === 'system') continue;

      const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
      const href = i < parts.length - 1
        ? '/' + parts.slice(0, i + 1).join('/')
        : undefined;
      items.push({ label, href });
    }

    return items;
  }, [location.pathname, projectName]);

  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-full" />
      <Breadcrumb>
        <BreadcrumbList>
          {breadcrumbs.map((crumb, i) => (
            <BreadcrumbItem key={i}>
              {i > 0 && <BreadcrumbSeparator />}
              {crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link to={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t('actions.search')}</span>
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border bg-muted px-1.5 text-[10px] font-mono">Ctrl+K</kbd>
        </button>
      </div>
    </header>
  );
}
