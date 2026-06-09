import type { Metadata, Viewport } from 'next';
import { BRAND } from '@/lib/brand';
// react-grid-layout's base CSS (Phase E, #73): grid item positioning + the
// resize-handle hit area. Imported BEFORE globals.css so our dark slate/amber
// overrides (in globals.css, .ngrid-rgl scope) win the cascade — RGL ships a
// light default we deliberately re-skin rather than ship unstyled.
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './globals.css';
import { PrefsProvider } from '@/lib/prefs';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  applicationName: BRAND.name,
  description: `${BRAND.tagline} — self-hosted analytics for your National Grid usage, bills, and rates.`,
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#f59e0b', // amber-500, matching the app accent
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      {/* The body fills the viewport so the cockpit dashboard (issue #2) can pin a
          no-scroll, full-height grid. Each page owns its own container/padding:
          the dashboard goes edge-to-edge and full-height; settings stays centered. */}
      <body className="h-full min-h-dvh">
        <PrefsProvider>{children}</PrefsProvider>
      </body>
    </html>
  );
}
