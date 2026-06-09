import { ImageResponse } from 'next/og';
import { BRAND } from '@/lib/brand';

// OG card (1200×630): bolt + "Ember" + tagline on slate. The app sits behind
// SSO so previews barely matter — this is a low-priority nicety drawn with
// next/og (no new dependency, no asset binary).
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${BRAND.name} — ${BRAND.tagline}`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          background: '#020617',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <svg width="140" height="140" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.5 5 8.5 17.6h6.4L13.5 27l10-12.6h-6.6L18.5 5Z" fill="#f59e0b" />
          </svg>
          <div style={{ fontSize: 132, fontWeight: 700, color: '#f8fafc', letterSpacing: -2 }}>
            {BRAND.name}
          </div>
        </div>
        <div style={{ fontSize: 40, color: '#94a3b8' }}>{BRAND.tagline}</div>
      </div>
    ),
    size,
  );
}
