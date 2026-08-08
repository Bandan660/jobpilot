import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  MAX_RESUME_BYTES,
  MAX_TOTAL_STORAGE_BYTES,
  RESUME_CONTENT_TYPES,
  type Resume,
} from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { resumes } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

/**
 * Resume storage, backed by R2.
 *
 * Objects are never addressable from outside. Every read looks the row up by
 * id AND user, then fetches by the key stored on that row — so a client can
 * only ever reach a file it owns, and there is no URL to leak. The key embeds
 * the user id as well, which means a mistake in that check still cannot cross
 * accounts by accident.
 */

type ResumeRow = typeof resumes.$inferSelect;

/** storageKey stays server-side; it is not in the DTO at all. */
function toDto(row: ResumeRow): Resume {
  return {
    id: row.id,
    userId: row.userId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    isDefault: row.isDefault,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

/** Strips path separators and anything that could confuse a download header. */
function safeFileName(raw: string): string {
  return (
    raw
      .split(/[\\/]/)
      .pop()!
      .replace(/[\r\n"]/g, '')
      .slice(0, 200) || 'resume'
  );
}

export const resumeRoutes = new Hono<AppContext>();

resumeRoutes.use('*', requireAuth);

/**
 * R2 has to be switched on in the dashboard before the binding exists. Without
 * this guard every resume route dies on `undefined.put` with a 500 that says
 * nothing useful.
 */
function bucket(c: { env: { RESUMES?: R2Bucket } }): R2Bucket {
  if (!c.env.RESUMES) {
    throw new HTTPException(503, { message: 'Resume storage is not configured yet.' });
  }
  return c.env.RESUMES;
}

resumeRoutes.get('/', async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select()
    .from(resumes)
    .where(eq(resumes.userId, c.get('userId')))
    .orderBy(desc(resumes.uploadedAt));

  return c.json({ resumes: rows.map(toDto) });
});

/**
 * Upload.
 *
 * The file is the raw request body, with its name in a header — not multipart.
 * One file needs no multipart envelope, and it avoids a parser whose typings
 * differ between the Workers runtime and the DOM.
 */
resumeRoutes.post('/', async (c) => {
  const userId = c.get('userId');

  const contentType = (c.req.header('Content-Type') ?? '').split(';')[0].trim();
  if (!RESUME_CONTENT_TYPES[contentType]) {
    throw new HTTPException(415, { message: 'Upload a PDF or Word document' });
  }

  // Reject on the declared length before reading, so an oversized upload is
  // refused without buffering it.
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > MAX_RESUME_BYTES) {
    throw new HTTPException(413, {
      message: `That file is over ${Math.round(MAX_RESUME_BYTES / 1024)}KB. Re-export it as PDF, or use a "reduce file size" option — most resumes shrink well below this without looking any different.`,
    });
  }

  const db = createDb(c.env);

  /*
   * Whatever this account already has. There is only ever one, and uploading
   * replaces it — these rows are collected at the end, once the new file is
   * safely stored.
   */
  const owned = await db
    .select({ id: resumes.id, storageKey: resumes.storageKey })
    .from(resumes)
    .where(eq(resumes.userId, userId));

  /*
   * The bucket-wide ceiling.
   *
   * Summed from the database rather than asked of R2, because R2 has no cheap
   * "how big is this bucket" call from inside a Worker — listing every object
   * to add up sizes would cost a Class A operation per page on every upload.
   * The rows are authoritative anyway: every object is written with one, and
   * deletes remove the object before the row.
   *
   * Read before the body, so a full bucket costs the uploader nothing.
   */
  const [usage] = await db
    .select({ total: sql<number>`coalesce(sum(${resumes.sizeBytes}), 0)` })
    .from(resumes);

  const used = Number(usage?.total ?? 0);

  if (used + declared > MAX_TOTAL_STORAGE_BYTES) {
    console.warn('resume storage ceiling reached', { used, limit: MAX_TOTAL_STORAGE_BYTES });
    throw new HTTPException(507, {
      message: 'Resume storage is full. Please try again later.',
    });
  }

  // Surfaces in the Worker log while there is still time to act, rather than
  // at the point uploads start failing.
  if (used > MAX_TOTAL_STORAGE_BYTES * 0.8) {
    console.warn('resume storage above 80%', {
      usedGb: (used / 1024 ** 3).toFixed(2),
      limitGb: (MAX_TOTAL_STORAGE_BYTES / 1024 ** 3).toFixed(2),
    });
  }

  const bytes = await c.req.arrayBuffer();

  if (bytes.byteLength === 0) {
    throw new HTTPException(400, { message: 'That file is empty' });
  }
  // Re-checked against the real body: Content-Length is client-supplied.
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new HTTPException(413, {
      message: `That file is over ${Math.round(MAX_RESUME_BYTES / 1024)}KB. Re-export it as PDF, or use a "reduce file size" option — most resumes shrink well below this without looking any different.`,
    });
  }

  const file = {
    name: decodeURIComponent(c.req.header('X-File-Name') ?? 'resume'),
    size: bytes.byteLength,
  };

  /*
   * Verify the file really is what it claims. Content-Type comes from the
   * client and is trivially wrong or spoofed; a PDF always starts "%PDF-", and
   * both .doc and .docx have their own signatures. Storing a mislabelled file
   * means it will not open later, which is a worse failure than refusing it now.
   */
  const head = new Uint8Array(bytes.slice(0, 4));
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  // DOCX is a zip ("PK"), legacy DOC is an OLE compound file.
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;

  if (contentType === 'application/pdf' ? !isPdf : !(isZip || isOle)) {
    throw new HTTPException(415, {
      message: 'That file does not look like a real PDF or Word document',
    });
  }

  const fileName = safeFileName(file.name);
  const id = crypto.randomUUID();
  const key = `resumes/${userId}/${id}`;

  await bucket(c).put(key, bytes, {
    httpMetadata: { contentType },
    // Stored so an orphaned object can be traced back without the database.
    customMetadata: { userId, fileName },
  });

  const [row] = await db
    .insert(resumes)
    .values({
      id,
      userId,
      fileName,
      storageKey: key,
      contentType,
      sizeBytes: file.size,
      // Always: there is only ever one.
      isDefault: true,
    })
    .returning();

  /*
   * Replace, rather than refuse.
   *
   * The order is load-bearing. The new object is written and its row inserted
   * *before* anything old is removed, so a failure part-way through leaves the
   * user with two resumes — which the next upload tidies — instead of none.
   * Deleting first would mean a failed upload destroys the only copy they had.
   *
   * Object before row, matching the delete route: a row with no object is a
   * download that 404s, while an object with no row is invisible but harmless.
   */
  for (const previous of owned) {
    try {
      await bucket(c).delete(previous.storageKey);
      await db.delete(resumes).where(eq(resumes.id, previous.id));
    } catch (error) {
      // Never fail the upload over cleanup: the new resume is already saved
      // and usable, and a leftover costs 200KB until the next replace.
      console.warn('could not remove replaced resume', previous.id, error);
    }
  }

  return c.json({ resume: toDto(row) }, 201);
});

/** Streams the object back. The only way to read a file. */
resumeRoutes.get('/:id/file', async (c) => {
  const db = createDb(c.env);
  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, c.req.param('id')), eq(resumes.userId, c.get('userId'))))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Resume not found' });

  const object = await bucket(c).get(row.storageKey);
  if (!object) {
    // Row without an object: the upload failed midway or the object was
    // removed out of band. Say so rather than returning an empty file.
    throw new HTTPException(404, { message: 'That file is no longer in storage' });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(row.sizeBytes),
      // `attachment` and a quoted name: a PDF rendered inline from an API
      // origin is a small XSS surface for no benefit.
      'Content-Disposition': `attachment; filename="${row.fileName}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
});

resumeRoutes.patch('/:id', async (c) => {
  const db = createDb(c.env);
  const userId = c.get('userId');
  const id = c.req.param('id');

  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, id), eq(resumes.userId, userId)))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Resume not found' });

  // Exactly one default. Clear the others first so a failure mid-way leaves
  // none rather than two.
  await db
    .update(resumes)
    .set({ isDefault: false })
    .where(and(eq(resumes.userId, userId), ne(resumes.id, id)));

  const [updated] = await db
    .update(resumes)
    .set({ isDefault: true })
    .where(eq(resumes.id, id))
    .returning();

  return c.json({ resume: toDto(updated) });
});

resumeRoutes.delete('/:id', async (c) => {
  const db = createDb(c.env);
  const userId = c.get('userId');

  const [row] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.id, c.req.param('id')), eq(resumes.userId, userId)))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Resume not found' });

  // Object first: a deleted row with a surviving object is an orphan nobody
  // can see or clean up. A surviving row with no object is at least visible.
  await bucket(c).delete(row.storageKey);
  await db.delete(resumes).where(eq(resumes.id, row.id));

  // Promote another so the user is not left with resumes and no default.
  if (row.isDefault) {
    const [next] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(eq(resumes.userId, userId))
      .orderBy(desc(resumes.uploadedAt))
      .limit(1);

    if (next) {
      await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, next.id));
    }
  }

  return c.body(null, 204);
});
