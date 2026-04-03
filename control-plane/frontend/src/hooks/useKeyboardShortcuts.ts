import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui.store';

export function useKeyboardShortcuts() {
  const { setCommandPaletteOpen } = useUIStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K — Command Palette (handled in CommandPalette but also here as backup)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }

      // Escape — close any open dialog/sheet (browser handles this for radix)
      // No custom handler needed — radix dialogs already handle Escape

      // Cmd+S / Ctrl+S — prevent browser save (forms handle their own submit)
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // Dispatch custom event that forms can listen to
        document.dispatchEvent(new CustomEvent('dataforge:save'));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);
}
