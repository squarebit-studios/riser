// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Handing the RiserApp instance to the React tree.
//
// The instance is created once with useState's lazy initialiser rather than in
// a useEffect, so it exists on the first render and components can call into
// it without null checks. Mounting - which needs a real DOM node - happens
// later, in Viewport3D.
// ==========================================================================

import React, { createContext, useContext, useEffect, useState } from 'react';
import { RiserApp } from './RiserApp';

const AppContext = createContext<RiserApp | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [app] = useState(() => new RiserApp());

  useEffect(() => {
    return () => app.unmount();
  }, [app]);

  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useApp(): RiserApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('useApp must be used inside <AppProvider>');
  return app;
}
