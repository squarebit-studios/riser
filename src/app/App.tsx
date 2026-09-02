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
import * as M from '../doc/mutations';
import { curveDef, getTemplate, guideDef } from '../templates';
import type { TemplateDef } from '../doc/types';
import type { OverlayTarget, RiserApp } from './RiserApp';

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
 * The part of the viewport menu that belongs to the thing you pressed on.
 *
 * Named after that thing, so the menu says which marker or curve it is about
 * before offering to change it. On a tablet this is the only way to reach any
 * of these: there is no right button, and the inspector needs the thing
 * selected first, which is the very step a long press is replacing.
 */
function TargetItems({
  target,
  template,
  app
}: {
  target: OverlayTarget;
  template: TemplateDef;
  app: RiserApp;
}): JSX.Element | null {
  if (target.kind === 'guide') {
    const def = guideDef(template, target.id);
    return (
      <>
        <MenuLabel>{def?.label ?? target.id}</MenuLabel>
        <MenuItem
          label="Focus"
          shortcut="F"
          onSelect={() => {
            useUiStore.getState().setSelectedGuideId(target.id);
            app.frameSelection();
          }}
        />
        <MenuItem
          label="Remove"
          icon="trash"
          onSelect={() =>
            app.store.apply(
              (d) => M.removeGuide(d, target.id),
              `Remove ${def?.label ?? target.id}`
            )
          }
        />
        <MenuSeparator />
      </>
    );
  }

  const curveId = target.kind === 'curve' ? target.id : target.curveId;
  const def = curveDef(template, curveId);
  const label = def?.label ?? curveId;

  return (
    <>
      <MenuLabel>{label}</MenuLabel>
      {target.kind === 'curvePoint' && (
        <MenuItem
          label="Remove point"
          onSelect={() =>
            app.store.apply(
              (d) => M.removeCurvePoint(d, curveId, target.index),
              `Remove ${label} point`
            )
          }
        />
      )}
      <MenuItem
        label="Mirror"
        onSelect={() => {
          useUiStore.getState().setActiveCurveId(curveId);
          app.mirrorCurve(curveId);
        }}
      />
      <MenuItem
        label="Clear"
        onSelect={() => {
          app.store.apply((d) => M.removeCurve(d, curveId), `Clear ${label}`);
          useUiStore.getState().setActiveCurveId(curveId);
          useUiStore.getState().setActiveTool('curve');
        }}
      />
      <MenuItem
        label="Remove"
        icon="trash"
        onSelect={() =>
          app.store.apply((d) => M.removeCurve(d, curveId), `Remove ${label}`)
        }
      />
      <MenuSeparator />
    </>
  );
}
/**
 * The viewport, and the menu you get by right-clicking it.
 *
 * The menu carries what someone is likely to want without travelling to the
 * top of the screen: framing, shading, and getting a hidden thing back.
 *
 * It also acts on whatever the press landed on, which this deliberately did
 * NOT do at first, on the reasoning that a menu meaning different things on
 * different presses is a menu you have to read every time. That reasoning
 * holds for a mouse, where the thing under the cursor can be clicked directly
 * and the menu is a convenience. It does not hold for a tablet, where there is
 * no right button and a long press is the ONLY way to point at a marker and
 * ask what can be done with it.
 *
 * The compromise is that the general items never move. What the press landed
 * on is added ABOVE them under its own name, so the menu grows a section
 * rather than changing meaning, and the items somebody has learned the
 * position of stay where they were.
 */
function ViewportArea(): JSX.Element {
  const app = useApp();
  // Not the plain context-menu hook the lists use: the viewport's right button
  // also pans the camera, so a press that moved has to be told from one that
  // did not. See useViewportMenu.
  const menu = useViewportMenu();
  const template = getTemplate(useUiStore((s) => s.templateId));
  // Resolved when the menu opens rather than watched continuously: it is a
  // raycast, and the answer only has to be true for the press that asked.
  const target = menu.point
    ? app.overlayAtClient(menu.point.x, menu.point.y)
    : null;
  // A long press opens this menu without the finger having moved, which the
  // tools would otherwise read as a click on release: in curve mode that adds
  // a control vertex under the menu that was just opened.
  useEffect(() => {
    if (menu.point) app.cancelGesture();
  }, [menu.point, app]);
  const viewMode = useUiStore((s) => s.viewMode);
  const showGeometry = useUiStore((s) => s.showGeometry);
  const showMarkers = useUiStore((s) => s.showMarkers);
  const guided = useUiStore((s) => s.guided);
  const characterName = useUiStore((s) => s.characterName);

  return (
    <div className="h-full w-full" {...menu.props}>
      <Viewport3D />

      <ContextMenu point={menu.point} onClose={menu.close} label="Viewport">
        {target && <TargetItems target={target} template={template} app={app} />}

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
          ui.setActiveTool('select');
          break;
        case '2':
          ui.setActiveTool('marker');
          break;
        case '3':
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
