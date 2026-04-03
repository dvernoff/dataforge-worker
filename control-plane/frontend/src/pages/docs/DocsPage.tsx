import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, BookOpen, ChevronRight, Globe, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePageTitle } from '@/hooks/usePageTitle';

const SECTION_IDS = [
  'intro',
  'features',
  'gettingStarted',
  'projects',
  'tablesSchema',
  'dataBrowser',
  'apiEndpoints',
  'apiDocs',
  'graphql',
  'webhooks',
  'cronJobs',
  'flows',
  'sqlConsole',
  'queryBuilder',
  'dashboardBuilder',
  'analytics',
  'pluginsOverview',
  'pluginsIntegrations',
  'pluginsFeatures',
  'authSecurity',
  'backupRestore',
  'workerNodes',
  'selfHostedNodes',
  'apiReference',
  'exampleUseCase',
] as const;

export function DocsPage() {
  const { t, i18n } = useTranslation(['docs', 'common']);
  usePageTitle(t('docs:title'));
  const [activeSection, setActiveSection] = useState<string>(SECTION_IDS[0]);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSections = useMemo(() => {
    if (!searchQuery) return [...SECTION_IDS];
    const lower = searchQuery.toLowerCase();
    return SECTION_IDS.filter((id) => {
      const title = t(`docs:sections.${id}.title`).toLowerCase();
      const content = t(`docs:sections.${id}.content`).toLowerCase();
      return title.includes(lower) || content.includes(lower);
    });
  }, [searchQuery, t]);

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col dark">
      {/* Top bar */}
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
          <Select value={i18n.language?.startsWith('ru') ? 'ru' : 'en'} onValueChange={changeLanguage}>
            <SelectTrigger className="w-24 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ru">Русский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r flex flex-col shrink-0 bg-card/50">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('docs:search')}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <nav className="p-2 space-y-0.5">
              {filteredSections.map((id, idx) => (
                <button
                  key={id}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 ${
                    activeSection === id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                  onClick={() => setActiveSection(id)}
                >
                  <span className="text-xs text-muted-foreground/60 w-5 shrink-0">{idx + 1}.</span>
                  <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${activeSection === id ? 'rotate-90' : ''}`} />
                  <span className="truncate">{t(`docs:sections.${id}.title`)}</span>
                </button>
              ))}
            </nav>
          </ScrollArea>
        </aside>

        {/* Content area */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-3xl mx-auto p-8">
            {activeSection ? (
              <>
                <h1 className="text-2xl font-bold mb-6">
                  {t(`docs:sections.${activeSection}.title`)}
                </h1>
                <div className="prose prose-sm prose-invert max-w-none">
                  {t(`docs:sections.${activeSection}.content`)
                    .split('\n\n')
                    .map((paragraph: string, i: number) => (
                      <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-4 whitespace-pre-line">
                        {paragraph}
                      </p>
                    ))}
                </div>
                {/* Navigation between sections */}
                <div className="flex justify-between mt-12 pt-6 border-t">
                  {SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]) > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const idx = SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]);
                        setActiveSection(SECTION_IDS[idx - 1]);
                      }}
                    >
                      <ChevronRight className="h-3 w-3 rotate-180 mr-1" />
                      {t(`docs:sections.${SECTION_IDS[SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]) - 1]}.title`)}
                    </Button>
                  ) : <div />}
                  {SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]) < SECTION_IDS.length - 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const idx = SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]);
                        setActiveSection(SECTION_IDS[idx + 1]);
                      }}
                    >
                      {t(`docs:sections.${SECTION_IDS[SECTION_IDS.indexOf(activeSection as typeof SECTION_IDS[number]) + 1]}.title`)}
                      <ChevronRight className="h-3 w-3 ml-1" />
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
