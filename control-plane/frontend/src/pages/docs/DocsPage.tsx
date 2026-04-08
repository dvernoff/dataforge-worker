import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, BookOpen, ChevronRight, ChevronDown, Globe, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { usePageTitle } from '@/hooks/usePageTitle';

interface DocSection {
  id: string;
  children?: DocSection[];
}

const DOC_TREE: DocSection[] = [
  { id: 'catStart', children: [
    { id: 'whatIs' },
    { id: 'whoIsFor' },
    { id: 'quickStart' },
  ]},
  { id: 'catProjects', children: [
    { id: 'projectBasics' },
    { id: 'roles' },
    { id: 'dashboard' },
  ]},
  { id: 'catDatabase', children: [
    { id: 'tables' },
    { id: 'dataBrowser' },
    { id: 'importExport' },
  ]},
  { id: 'catApi', children: [
    { id: 'restApi' },
    { id: 'apiTokens' },
    { id: 'apiDocs' },
  ]},
  { id: 'catPlugins', children: [
    { id: 'pluginSystem' },
    { id: 'pluginAnalytics' },
    { id: 'pluginCron' },
    { id: 'pluginWebhooks' },
    { id: 'pluginGraphql' },
    { id: 'pluginWebsocket' },
    { id: 'pluginSdk' },
    { id: 'pluginPlayground' },
    { id: 'pluginDbMap' },
    { id: 'pluginQueryBuilder' },
    { id: 'pluginKanban' },
    { id: 'pluginCalendar' },
    { id: 'pluginGallery' },
    { id: 'pluginDashboards' },
    { id: 'pluginBackups' },
  ]},
  { id: 'catIntegrations', children: [
    { id: 'intDiscord' },
    { id: 'intTelegram' },
    { id: 'intUptime' },
    { id: 'intSboxAuth' },
  ]},
  { id: 'catExamples', children: [
    { id: 'exGameServer' },
    { id: 'exMonitoring' },
  ]},
];

function flattenTree(tree: DocSection[]): string[] {
  const result: string[] = [];
  for (const s of tree) {
    if (s.children) for (const c of s.children) result.push(c.id);
    else result.push(s.id);
  }
  return result;
}

const CATEGORY_IDS = new Set(DOC_TREE.filter((s) => s.children).map((s) => s.id));

const ALL_IDS = flattenTree(DOC_TREE);

export function DocsPage() {
  const { t, i18n } = useTranslation(['docs', 'common']);
  usePageTitle(t('docs:title'));
  const [activeSection, setActiveSection] = useState<string>(ALL_IDS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(DOC_TREE.map((s) => s.id)));

  const filteredIds = useMemo(() => {
    if (!searchQuery) return new Set(ALL_IDS);
    const lower = searchQuery.toLowerCase();
    const matched = new Set<string>();
    for (const id of ALL_IDS) {
      const title = t(`docs:sections.${id}.title`, '').toLowerCase();
      const content = t(`docs:sections.${id}.content`, '').toLowerCase();
      if (title.includes(lower) || content.includes(lower)) matched.add(id);
    }
    for (const cat of DOC_TREE) {
      if (cat.children?.some((c) => matched.has(c.id))) matched.add(cat.id);
    }
    return matched;
  }, [searchQuery, t]);

  const toggleCat = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allFlat = ALL_IDS.filter((id) => filteredIds.has(id));
  const currentIdx = allFlat.indexOf(activeSection);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col dark">
      <header className="h-14 border-b bg-card flex items-center px-4 gap-4 shrink-0">
        <a href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          <span className="text-sm">{t('docs:backToApp')}</span>
        </a>
        <div className="flex items-center gap-2 ml-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{t('docs:title')}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <Select value={i18n.language?.startsWith('ru') ? 'ru' : 'en'} onValueChange={(l) => i18n.changeLanguage(l)}>
            <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r flex flex-col shrink-0 bg-card/50">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('docs:search')} className="pl-8 h-8 text-sm" />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <nav className="p-2 space-y-1">
              {DOC_TREE.map((cat) => {
                const hasChildren = cat.children && cat.children.length > 0;
                const isExpanded = expandedCats.has(cat.id);
                const childIds = cat.children?.map((c) => c.id) ?? [];
                const hasVisibleChildren = hasChildren && childIds.some((id) => filteredIds.has(id));
                if (hasChildren && !hasVisibleChildren) return null;
                if (!hasChildren && !filteredIds.has(cat.id)) return null;

                return (
                  <div key={cat.id}>
                    {hasChildren ? (
                      <button
                        className="w-full text-left px-3 py-2 rounded-md text-[11px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
                        onClick={() => {
                          toggleCat(cat.id);
                          if (!isExpanded && childIds[0]) setActiveSection(childIds[0]);
                        }}
                      >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {t(`docs:sections.${cat.id}.title`)}
                      </button>
                    ) : (
                      <button
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          activeSection === cat.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                        }`}
                        onClick={() => setActiveSection(cat.id)}
                      >
                        {t(`docs:sections.${cat.id}.title`)}
                      </button>
                    )}
                    {hasChildren && isExpanded && cat.children!.map((child) => {
                      if (!filteredIds.has(child.id)) return null;
                      return (
                        <button
                          key={child.id}
                          className={`w-full text-left pl-8 pr-3 py-1.5 rounded-md text-sm transition-colors ${
                            activeSection === child.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          }`}
                          onClick={() => setActiveSection(child.id)}
                        >
                          {t(`docs:sections.${child.id}.title`)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
          </ScrollArea>
        </aside>

        <main className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto p-8">
            {activeSection ? (
              <>
                <h1 className="text-2xl font-bold mb-6">{t(`docs:sections.${activeSection}.title`)}</h1>
                <div className="prose prose-sm prose-invert max-w-none">
                  {t(`docs:sections.${activeSection}.content`, '').split('\n\n').map((p: string, i: number) => (
                    <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-line">{p}</p>
                  ))}
                </div>
                <div className="flex justify-between mt-12 pt-6 border-t">
                  {currentIdx > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setActiveSection(allFlat[currentIdx - 1])}>
                      <ChevronRight className="h-3 w-3 rotate-180 mr-1" />{t(`docs:sections.${allFlat[currentIdx - 1]}.title`)}
                    </Button>
                  ) : <div />}
                  {currentIdx < allFlat.length - 1 ? (
                    <Button variant="ghost" size="sm" onClick={() => setActiveSection(allFlat[currentIdx + 1])}>
                      {t(`docs:sections.${allFlat[currentIdx + 1]}.title`)}<ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  ) : <div />}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>{t('docs:selectSection')}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
