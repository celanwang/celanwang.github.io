import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { rehypeCodeWrap } from './src/lib/rehype-code-wrap.ts';
import { rehypeTableScroll } from './src/lib/rehype-table-scroll.ts';
import { rehypeHeadingAnchor } from './src/lib/rehype-heading-anchor.ts';
import { rehypeContentImages } from './src/lib/rehype-content-images.ts';

export default defineConfig({
  site: 'https://bytego.cloud',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light-high-contrast',
        dark: 'github-dark-high-contrast',
      },
      defaultColor: false,
      wrap: true,
    },
    rehypePlugins: [rehypeCodeWrap, rehypeTableScroll, rehypeHeadingAnchor, rehypeContentImages],
  },
});
