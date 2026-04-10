import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui.store';

export function useKeyboardShortcuts() {
  const { setCommandPaletteOpen } = useUIStore();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+S / Ctrl+S — prevent browser save (forms handle their own submit)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault();
        // Dispatch custom event that forms can listen to
        document.dispatchEvent(new CustomEvent('dataforge:save'));
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);
}
