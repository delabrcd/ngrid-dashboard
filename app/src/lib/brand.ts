// Product identity (UI/branding only). The repo, GHCR image, compose project,
// and all deploy/install references stay `ngrid-dashboard` — only the
// user-facing name is "Ember". Keep this dependency-free: it's imported by both
// server metadata (layout.tsx) and client components (BrandMark.tsx).
export const BRAND = {
  name: 'Ember',
  tagline: 'home energy, in focus',
} as const;
