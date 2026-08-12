import { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import { blogPosts } from '../db/schema.js';
import type { AppContext } from '../env.js';

export const publicBlogRoutes = new Hono<AppContext>();

/** Fetch all published dynamic blog posts. */
publicBlogRoutes.get('/', async (c) => {
  try {
    const db = createDb(c.env);
    const posts = await db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.published, true))
      .orderBy(desc(blogPosts.createdAt));
    return c.json(posts);
  } catch (error) {
    // If table doesn't exist yet or DB issue, fail gracefully with empty array
    return c.json([]);
  }
});

/** Fetch single published post by slug. */
publicBlogRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  try {
    const db = createDb(c.env);
    const [post] = await db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.slug, slug), eq(blogPosts.published, true)))
      .limit(1);

    if (!post) {
      return c.json({ error: 'not_found', message: 'Post not found' }, 404);
    }
    return c.json(post);
  } catch (error) {
    return c.json({ error: 'not_found', message: 'Post not found' }, 404);
  }
});
