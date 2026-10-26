import { getCollection, type CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

/** Published posts, newest first. */
export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/**
 * Rough reading time for Chinese + English mixed body.
 * CJK chars count as 1; Latin words count as 1; ~300 units/min.
 */
export function estimateReadingMinutes(body: string | undefined): number {
  if (!body) return 1;
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/[#>*_\-|]/g, ' ')
    .trim();

  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.max(1, Math.ceil((cjk + latin) / 300));
}

export function readingLabel(minutes: number): string {
  return `${minutes} min read`;
}

/** Adjacent posts by date order (newest → oldest). prev = older, next = newer. */
export function getAdjacentPosts(posts: BlogPost[], id: string) {
  const index = posts.findIndex((p) => p.id === id);
  if (index === -1) return { prev: undefined, next: undefined };
  return {
    next: index > 0 ? posts[index - 1] : undefined,
    prev: index < posts.length - 1 ? posts[index + 1] : undefined,
  };
}

/** Related by shared tags, excluding current; max `limit`. */
export function getRelatedPosts(posts: BlogPost[], current: BlogPost, limit = 3): BlogPost[] {
  const tags = new Set(current.data.tags);
  if (tags.size === 0) return [];

  return posts
    .filter((p) => p.id !== current.id)
    .map((p) => ({
      post: p,
      score: p.data.tags.reduce((n, t) => n + (tags.has(t) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf())
    .slice(0, limit)
    .map((x) => x.post);
}
