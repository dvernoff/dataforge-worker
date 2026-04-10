import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, Table2, Database, Plug, Webhook, Terminal,
  ScrollText, Settings, Users, KeyRound, Key, Shield, Search,
} from 'lucide-react';
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command';
import { useAuthStore } from '@/stores/auth.store';
import { useUIStore } from '@/stores/ui.store';

interface CommandEntry {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  group: string;
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useUIStore();
  const { user } = useAuthStore();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === '/' && !commandPaletteOpen) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const commands = useMemo(() => {
    const items: CommandEntry[] = [];
    const basePath = slug ? `/projects/${slug}` : '';

    if (slug) {
      items.push(
        { label: 'Dashboard', icon: LayoutDashboard, path: `${basePath}/dashboard`, group: 'Navigation' },
        { label: 'Tables', icon: Table2, path: `${basePath}/tables`, group: 'Navigation' },
        { label: 'API Endpoints', icon: Plug, path: `${basePath}/endpoints`, group: 'Navigation' },
        { label: 'Webhooks', icon: Webhook, path: `${basePath}/webhooks`, group: 'Navigation' },
        { label: 'SQL Console', icon: Terminal, path: `${basePath}/sql`, group: 'Navigation' },
        { label: 'Audit Log', icon: ScrollText, path: `${basePath}/audit`, group: 'Navigation' },
        { label: 'Users', icon: Users, path: `${basePath}/settings/users`, group: 'Settings' },
        { label: 'Invite Keys', icon: KeyRound, path: `${basePath}/settings/invites`, group: 'Settings' },
        { label: 'API Tokens', icon: Key, path: `${basePath}/settings/tokens`, group: 'Settings' },
      );
    }

    items.push({ label: 'All Projects', icon: Database, path: '/', group: 'Global' });

    if (user?.is_superadmin) {
      items.push(
        { label: 'System: All Projects', icon: Shield, path: '/system/projects', group: 'System' },
        { label: 'System: All Users', icon: Users, path: '/system/users', group: 'System' },
        { label: 'System: Logs', icon: ScrollText, path: '/system/logs', group: 'System' },
      );
    }

    return items;
  }, [slug, user?.is_superadmin]);

  const groups = useMemo(() => {
    const map = new Map<string, CommandEntry[]>();
    for (const cmd of commands) {
      const list = map.get(cmd.group) ?? [];
      list.push(cmd);
      map.set(cmd.group, list);
    }
    return map;
  }, [commands]);

  function handleSelect(path: string) {
    navigate(path);
    setCommandPaletteOpen(false);
  }

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Array.from(groups.entries()).map(([group, items], i) => (
          <div key={group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {items.map((item) => (
                <CommandItem key={item.path} onSelect={() => handleSelect(item.path)}>
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
