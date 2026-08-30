// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Where the app talks to the store backend.
// ==========================================================================

/**
 * Base URL of the store API, INCLUDING its global prefix.
 *
 * The backend calls `app.setGlobalPrefix('api/v1')` (main.ts), so every route
 * the Riser module declares as `riser/documents` is actually served at
 * `/api/v1/riser/documents`. Baking the prefix in here means the storage
 * adapter's paths read exactly like the controller's decorators.
 *
 * Override per environment with VITE_API_BASE_URL.
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV
    ? 'http://localhost:5000/api/v1'
    : 'https://api.squarebitstudios.com/api/v1');

/**
 * Whether to attempt server-backed storage at all.
 *
 * Riser works fully signed-out against localStorage. Saving to an account is
 * additive, so a deployment with no API reachable should degrade to local
 * documents rather than presenting a broken Save button.
 */
export const SERVER_STORAGE_ENABLED: boolean =
  (import.meta.env.VITE_SERVER_STORAGE as string | undefined) !== 'off';
