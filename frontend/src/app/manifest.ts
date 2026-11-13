import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Laxalab',
    short_name: 'Laxalab',
    description: 'Professional online learning, certification and career development in Arabic and English.',
    start_url: '/ar',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0b1120',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
