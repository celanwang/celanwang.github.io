import rss from '@astrojs/rss';
import { render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { getPublishedPosts } from '../lib/posts';

/** Strip UI chrome that must not leak into feed content. */
function cleanContent(html, site) {
  return html
    .replace(/<div class="code-head">.*?<\/div>/gs, '')
    .replace(/<a class="heading-anchor"[^>]*>[^<]*<\/a>/g, '')
    .replace(/(href|src)="\/([^"]*)"/g, (_, attr, p) => `${attr}="${new URL(`/${p}`, site).href}"`);
}

export async function GET(context) {
  const posts = await getPublishedPosts();
  const container = await AstroContainer.create();

  const items = [];
  for (const post of posts) {
    const { Content } = await render(post);
    const html = await container.renderToString(Content);
    items.push({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
      content: cleanContent(html, context.site),
    });
  }

  return rss({
    title: 'Byte Cloud',
    description: 'Notes on agentic engineering.',
    site: context.site,
    xmlns: { content: 'http://purl.org/rss/1.0/modules/content/' },
    items,
    customData: `<language>zh-CN</language>`,
  });
}
