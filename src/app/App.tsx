// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The application layout, and the keyboard shortcuts that are global rather
// than owned by a tool.
// ==========================================================================

import { useEffect } from 'react';
import { AppProvider, useApp } from './AppContext';
import { Viewport3D } from './components/Viewport3D';
import { Toolbar } from './components/Toolbar';
import { Checklist } from './components/Checklist';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';
import { useUiStore } from './state';

export function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell(): JSX.Element {
  useGlobalShortcuts();

  return (
    <div className="flex h-full flex-col bg-panel text-ink">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-edge bg-panel">
          <Checklist />
        </aside>
        <main className="min-w-0 flex-1">
          <Viewport3D />
        </main>
        <aside className="w-72 shrink-0 border-l border-edge bg-panel">
          <Inspector />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}

/**
 * Shortcuts that belong to the app rather than to a tool.
 *
 * Tool-local keys (delete, C for close, escape) are handled by the tools
 * themselves via ToolManager, which only sees events while the canvas has
 * focus. These are bound to the window, so they work wherever the user is -
 * except in a text field, where typing must win.
 */
function useGlobalShortcuts(): void {
  const app = useApp();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const ui = useUiStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        app.redo();
        return;
      }

      switch (e.key) {
        case '1':
          ui.setActiveTool('marker');
          break;
        case '2':
          ui.setActiveTool('curve');
          break;
        case 'f':
        case 'F':
          app.frameSelection();
          break;
        case 'a':
        case 'A':
          app.frameCharacter();
          break;
        case 's':
        case 'S':
          ui.toggleSymmetry();
          break;
        case 'x':
        case 'X':
          ui.toggleXray();
          break;
        case 'g':
        case 'G':
          ui.toggleGrid();
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [app]);
}
