import { Hono } from 'hono';
import { createDb } from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { getAdminMetrics } from '../services/admin.js';
import type { AppContext } from '../env.js';

export const adminRoutes = new Hono<AppContext>();

/*
 * Both, in this order, on every route in this module.
 *
 * `requireAuth` establishes who the caller is; `requireAdmin` decides whether
 * that person may be here. Applied with a wildcard rather than per-route so a
 * route added later cannot be the one that forgot — the failure mode of
 * per-route middleware is a new endpoint quietly shipping unguarded.
 */
adminRoutes.use('*', requireAuth);
adminRoutes.use('*', requireAdmin);

import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { blogPosts } from '../db/schema.js';

/** Service-wide aggregates. No personal data — see services/admin.ts. */
adminRoutes.get('/metrics', async (c) => {
  const db = createDb(c.env);
  return c.json(await getAdminMetrics(db));
});

/* -------------------------------------------------------------------------- */
/* Blog Management (Admin only)                                                */
/* -------------------------------------------------------------------------- */

const blogPostSchema = z.object({
  title: z.string().min(3).max(200),
  slug: z.string().max(200).optional(),
  summary: z.string().min(5).max(1000),
  category: z.string().default('Job search'),
  author: z.string().default('BanApply Team'),
  readingMinutes: z.number().int().min(1).default(3),
  tags: z.array(z.string()).default([]),
  content: z.string().min(10),
  published: z.boolean().default(true),
});

/** List all blog posts for admin management (including drafts). */
adminRoutes.get('/blog', async (c) => {
  const db = createDb(c.env);
  const posts = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt));
  return c.json(posts);
});

/** Create a new blog post. */
adminRoutes.post('/blog', async (c) => {
  const parsed = blogPostSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'Invalid blog post input' });
  }

  const { title, summary, category, author, readingMinutes, tags, content, published } = parsed.data;
  const slug = (parsed.data.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).trim();

  const db = createDb(c.env);
  const existing = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, slug)).limit(1);
  if (existing.length > 0) {
    throw new HTTPException(409, { message: 'A post with that slug already exists' });
  }

  const [post] = await db
    .insert(blogPosts)
    .values({
      title,
      slug,
      summary,
      category,
      author,
      readingMinutes,
      tags,
      content,
      published,
    })
    .returning();

  return c.json(post, 201);
});

/** Update an existing blog post. */
adminRoutes.put('/blog/:id', async (c) => {
  const id = c.req.param('id');
  const parsed = blogPostSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid input' });
  }

  const db = createDb(c.env);
  const [post] = await db
    .update(blogPosts)
    .set({
      ...parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(blogPosts.id, id))
    .returning();

  if (!post) {
    throw new HTTPException(404, { message: 'Blog post not found' });
  }

  return c.json(post);
});

/** Delete a blog post. */
adminRoutes.delete('/blog/:id', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env);
  const [deleted] = await db.delete(blogPosts).where(eq(blogPosts.id, id)).returning();
  if (!deleted) {
    throw new HTTPException(404, { message: 'Blog post not found' });
  }
  return c.json({ ok: true, deletedId: id });
});
