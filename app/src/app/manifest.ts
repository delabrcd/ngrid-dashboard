import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: '/',
    display: 'standalone',
    background_color: '#020617', // slate-950
    theme_color: '#f59e0b', // amber-500
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
  };
}
