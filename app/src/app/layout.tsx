import type { Metadata } from 'next';
import './globals.css';
import { PrefsProvider } from '@/lib/prefs';

export const metadata: Metadata = {
  title: 'National Grid Dashboard',
  description: 'Self-hosted analytics for your National Grid usage, bills, and rates.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <PrefsProvider>
          <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
        </PrefsProvider>
      </body>
    </html>
  );
}
