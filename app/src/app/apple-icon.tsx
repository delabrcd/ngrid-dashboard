import { ImageResponse } from 'next/og';

// Apple touch icon (180×180): the amber bolt on a slate rounded tile, matching
// icon.svg. Drawn with next/og (ships with Next) so we add no asset binary.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          borderRadius: 40,
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.5 5 8.5 17.6h6.4L13.5 27l10-12.6h-6.6L18.5 5Z" fill="#f59e0b" />
        </svg>
      </div>
    ),
    size,
  );
}
