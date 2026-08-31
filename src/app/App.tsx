// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The application layout, and the shortcuts that belong to the app rather than
// to a tool.
//
// The shape is deliberately ordinary - menu bar, toolbar, panels either side
// of the work, status line - because an ordinary shape is one nobody has to
// learn. The character is the largest thing on screen and everything else gets
// out of its way.
// ==========================================================================

import { useEffect } from 'react';
import { AppProvider, useApp } from './AppContext';
import { Viewport3D } from './components/Viewport3D';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { TemplateBrowser } from './components/TemplateBrowser';
import { Inspector } from './components/Inspector';
import { StatusBar } from './components/StatusBar';
import { SidePanel } from './components/ui/SidePanel';
import { ContextMenu, MenuItem, MenuLabel, MenuSeparator } from './components/ui/Menu';
import { useViewportMenu } from './components/ui/useViewportMenu';
import { VIEW_MODES } from '../viewport/ViewModes';
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

  const leftWidth = useUiStore((s) => s.leftWidth);
  const rightWidth = useUiStore((s) => s.rightWidth);
  const leftCollapsed = useUiStore((s) => s.leftCollapsed);
  const rightCollapsed = useUiStore((s) => s.rightCollapsed);
  const activeTool = useUiStore((s) => s.activeTool);

  return (
    <div className="flex h-full flex-col bg-panel text-ink">
      <MenuBar />
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        <SidePanel
          side="left"
          title={activeTool === 'curve' ? 'Curves' : 'Markers'}
          icon={activeTool === 'curve' ? 'curve' : 'list'}
          width={leftWidth}
          collapsed={leftCollapsed}
          onWidthChange={(w) => useUiStore.getState().setPanelWidth('left', w)}
          onCollapsedChange={(c) => useUiStore.getState().setPanelCollapsed('left', c)}
        >
          <TemplateBrowser />
        </SidePanel>

        <main className="relative min-w-0 flex-1">
          <ViewportArea />
        </main>

        <SidePanel
          side="right"
          title="Inspector"
          icon="sliders"
          width={rightWidth}
          collapsed={rightCollapsed}
          onWidthChange={(w) => useUiStore.getState().setPanelWidth('right', w)}
          onCollapsedChange={(c) => useUiStore.getState().setPanelCollapsed('right', c)}
        >
          <Inspector />
        </SidePanel>
      </div>

      <StatusBar />
    </div>
  );
}

/**
 * The viewport, and the menu you get by right-clicking it.
 *
 * The menu carries what someone is likely to want without travelling to the
 * top of the screen: framing, shading, and getting a hidden thing back. It
 * deliberately does not try to act on whatever was under the cursor - a
 * right-click that sometimes means "this marker" and sometimes means "the
 * view" is a menu you have to read every time.
 */
function ViewportArea(): JSX.Element {
  const app = useApp();
  // Not the plain context-menu hook the lists use: the viewport's right button
  // also pans the camera, so a press that moved has to be told from one that
  // did not. See useViewportMenu.
  const menu = useViewportMenu();
  const viewMode = useUiStore((s) => s.viewMode);
  const showGeometry = useUiStore((s) => s.showGeometry);
  const showMarkers = useUiStore((s) => s.showMarkers);
  const guided = useUiStore((s) => s.guided);
  const characterName = useUiStore((s) => s.characterName);

  return (
    <div className="h-full w-full" {...menu.props}>
      <Viewport3D />

      <ContextMenu point={menu.point} onClose={menu.close} label="Viewport">
        <MenuItem
          label="Frame character"
          icon="frame"
          shortcut="A"
          disabled={!characterName}
          onSelect={() => app.frameCharacter()}
        />
        <MenuItem
          label="Focus selection"
          shortcut="F"
          onSelect={() => app.frameSelection()}
        />

        <MenuSeparator />
        <MenuItem
          label="Place markers automatically"
          icon="sparkles"
          disabled={!app.canAutoPlace}
          onSelect={() => app.autoPlace({ announce: true })}
        />

        <MenuSeparator />
        <MenuLabel>Shading</MenuLabel>
        {VIEW_MODES.map((mode) => (
          <MenuItem
            key={mode.id}
            label={mode.label}
            checked={viewMode === mode.id}
            onSelect={() => useUiStore.getState().setViewMode(mode.id)}
          />
        ))}

        <MenuSeparator />
        <MenuItem
          label="Character"
          icon="cube"
          checked={showGeometry}
          onSelect={() => useUiStore.getState().toggleGeometry()}
        />
        <MenuItem
          label="Markers"
          icon="marker"
          checked={showMarkers}
          onSelect={() => useUiStore.getState().toggleMarkers()}
        />
        <MenuItem
          label="Step-by-step guidance"
          checked={guided}
          onSelect={() => useUiStore.getState().setGuided(!guided)}
        />
      </ContextMenu>
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
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void app.saveDocument();
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        app.startNewDocument();
        return;
      }
      // Ctrl+F for the template search, the way every list with a search field
      // behaves. Without it the field is there but nobody reaches it.
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        ui.setPanelCollapsed('left', false);
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>('[data-testid="template-search"]')
            ?.focus();
        });
        return;
      }
      if (mod) return;

      // "?" opens the documentation, which is what it does nearly everywhere
      // else. Dispatched as an event so the menu bar - which owns the dialog -
      // can answer it without this hook knowing about the dialog at all.
      if (e.key === '?') {
        window.dispatchEvent(new CustomEvent('riser:open-docs'));
        e.preventDefault();
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
