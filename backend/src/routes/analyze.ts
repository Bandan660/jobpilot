import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createDb } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

/**
 * Job-to-profile match analysis.
 *
 * Runs here rather than in the extension for one reason: the API key. A key
 * shipped inside an extension is public — anyone can unzip a .crx — and it
 * would be billed to us by whoever found it first. The extension sends the
 * posting, the server adds the profile it already holds, and the key never
 * leaves the Worker.
 *
 * The result is advisory. It reports overlap between a posting's stated
 * requirements and what the profile actually says, and deliberately does not
 * dress that up as a hiring prediction — nothing here can see the other
 * applicants, the budget, or whether the role is already filled.
 */

const MODEL = 'gemini-2.0-flash';

const analyzeSchema = z.object({
  title: z.string().max(300).nullable(),
  company: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  /*
   * Truncated well below the model's context limit. Job descriptions run to
   * pages of boilerplate about company values, and paying to tokenize the
   * legal footer of every posting adds nothing to a skills comparison.
   */
  description: z.string().max(12_000),
});

export interface MatchAnalysis {
  score: number;
  verdict: string;
  matched: string[];
  missing: string[];
}

/**
 * The model returns JSON in a fenced block about as often as it returns bare
 * JSON, whatever the prompt says. Both are handled rather than retried.
 */
function parseJson(raw: string): MatchAnalysis | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).trim();

  try {
    const parsed = JSON.parse(candidate) as Partial<MatchAnalysis>;
    if (typeof parsed.score !== 'number') return null;

    return {
      // The model occasionally returns 0-1 or overshoots; clamp rather than
      // reject, since the rest of the answer is usually still good.
      score: Math.max(0, Math.min(100, Math.round(parsed.score <= 1 ? parsed.score * 100 : parsed.score))),
      verdict: String(parsed.verdict ?? '').slice(0, 300),
      matched: Array.isArray(parsed.matched) ? parsed.matched.slice(0, 12).map(String) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 12).map(String) : [],
    };
  } catch {
    return null;
  }
}

export const analyzeRoutes = new Hono<AppContext>();

analyzeRoutes.use('*', requireAuth);

analyzeRoutes.post('/', async (c) => {
  const key = (c.env.GEMINI_API_KEY ?? '').replace(/^﻿/, '').trim();
  if (!key) {
    throw new HTTPException(503, { message: 'Match analysis is not configured.' });
  }

  const parsed = analyzeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid posting payload.' });
  }

  const db = createDb(c.env);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, c.get('userId')))
    .limit(1);

  if (!profile) {
    throw new HTTPException(400, { message: 'Fill in your profile first.' });
  }

  /*
   * Only the parts of the profile that bear on suitability. Contact details,
   * demographics and saved answers are irrelevant to a skills comparison and
   * have no business being sent to a third party.
   */
  const candidate = {
    currentTitle: profile.currentTitle,
    skills: profile.skills ?? [],
    languages: profile.languages ?? [],
    experience: (profile.experience ?? []).map((role) => ({
      title: role.title,
      company: role.company,
      startDate: role.startDate,
      endDate: role.current ? 'present' : role.endDate,
      description: role.description?.slice(0, 600) ?? null,
    })),
    education: (profile.education ?? []).map((entry) => ({
      level: entry.level,
      degree: entry.degree,
      field: entry.field,
    })),
  };

  const prompt = [
    'Compare a candidate against a job posting. Reply with JSON only, no prose.',
    '',
    'Shape:',
    '{"score": <0-100>, "verdict": "<one sentence, max 25 words>",',
    ' "matched": ["<requirement the candidate demonstrably meets>"],',
    ' "missing": ["<stated requirement not evidenced in the profile>"]}',
    '',
    'Rules:',
    '- Judge only against requirements the posting actually states.',
    '- A skill counts as matched only if the profile evidences it. Do not infer',
    '  from job titles alone.',
    '- List at most 8 items per array, most important first.',
    '- score reflects overlap with stated requirements, not likelihood of being',
    '  hired — you cannot see other applicants.',
    '- Address the candidate as "you" in the verdict.',
    '',
    `POSTING: ${parsed.data.title ?? 'Unknown role'} at ${parsed.data.company ?? 'unknown company'}`,
    parsed.data.location ? `LOCATION: ${parsed.data.location}` : '',
    '',
    parsed.data.description,
    '',
    'CANDIDATE:',
    JSON.stringify(candidate),
  ]
    .filter(Boolean)
    .join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Low, because this is an extraction task. A creative reading of
          // someone's CV is the opposite of useful here.
          temperature: 0.2,
          maxOutputTokens: 700,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // 429 is the free tier's rate limit and is worth naming, since it is the
    // one failure the user can do something about (wait).
    const message =
      response.status === 429
        ? 'Analysis is rate limited right now — try again shortly.'
        : 'Could not analyse this posting.';
    console.warn('gemini failed', response.status, detail.slice(0, 300));
    throw new HTTPException(response.status === 429 ? 429 : 502, { message });
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const analysis = parseJson(text);

  if (!analysis) {
    throw new HTTPException(502, { message: 'Analysis came back unreadable.' });
  }

  return c.json({ analysis });
});

/* ------------------------- free-text answer drafts ------------------------ */

const answerSchema = z.object({
  question: z.string().min(8).max(600),
  title: z.string().max(300).nullable(),
  company: z.string().max(200).nullable(),
  jobUrl: z.string().url().max(2000),
});

/**
 * Draft an answer to an application's free-text question.
 *
 * THE CONSTRAINT THAT MATTERS
 *
 * This writes in the user's voice about the user's history, which makes
 * fabrication the whole risk. A model asked "why do you want to work here"
 * with a thin profile will happily invent an internship. So the prompt is
 * built to refuse: it is given the profile as the only permitted source of
 * fact, and told to return an empty string rather than fill a gap. An empty
 * draft is a good outcome — it means the profile does not support an answer,
 * which is exactly when the user needs to write one themselves.
 *
 * The extension fills the result as a highlighted draft and never submits it.
 * Nothing about this endpoint changes that: it returns text, not an action.
 */
analyzeRoutes.post('/answer', async (c) => {
  const key = (c.env.GEMINI_API_KEY ?? '').replace(/^﻿/, '').trim();
  if (!key) {
    throw new HTTPException(503, { message: 'Answer drafting is not configured.' });
  }

  const parsed = answerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid question payload.' });
  }

  const db = createDb(c.env);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, c.get('userId')))
    .limit(1);

  if (!profile) {
    throw new HTTPException(400, { message: 'Fill in your profile first.' });
  }

  /*
   * Broader than the match analysis sends, because answering "describe a
   * project you are proud of" needs the descriptions the score never reads.
   * Still no contact details and no demographics: an essay answer has no use
   * for either, and they are the fields with the most to lose.
   *
   * Saved answers are included as voice, not as content — the user's own
   * previous wording is the best guide to how they write.
   */
  const source = {
    currentTitle: profile.currentTitle,
    skills: profile.skills ?? [],
    experience: (profile.experience ?? []).map((role) => ({
      title: role.title,
      company: role.company,
      startDate: role.startDate,
      endDate: role.current ? 'present' : role.endDate,
      description: role.description?.slice(0, 900) ?? null,
    })),
    education: (profile.education ?? []).map((entry) => ({
      level: entry.level,
      degree: entry.degree,
      field: entry.field,
      school: entry.school,
    })),
    previousAnswers: (profile.savedAnswers ?? []).slice(0, 6).map((entry) => entry.answer),
  };

  const prompt = [
    "Draft this candidate's answer to one job-application question.",
    '',
    'ABSOLUTE RULE: every fact in the answer must come from the CANDIDATE data',
    'below. Do not invent employers, projects, dates, numbers, technologies or',
    'achievements. Do not restate a job title as an accomplishment. If the data',
    'does not support a genuine answer, reply with exactly: NO_BASIS',
    '',
    'Style:',
    '- First person, plain, specific. No "I am passionate about", no filler.',
    '- Match the register of PREVIOUS ANSWERS if any are given.',
    '- 60-120 words unless the question clearly wants less.',
    '- Reply with the answer text only. No preamble, no quotes, no markdown.',
    '',
    `ROLE: ${parsed.data.title ?? 'Unknown role'} at ${parsed.data.company ?? 'unknown company'}`,
    `QUESTION: ${parsed.data.question}`,
    '',
    'CANDIDATE:',
    JSON.stringify(source),
  ].join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Higher than the analysis: this is prose, and 0.2 reads like a
          // form letter. Still low enough that it stays close to the source.
          temperature: 0.5,
          maxOutputTokens: 400,
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const message =
      response.status === 429
        ? 'Answer drafting is rate limited right now — try again shortly.'
        : 'Could not draft an answer.';
    console.warn('gemini answer failed', response.status, detail.slice(0, 300));
    throw new HTTPException(response.status === 429 ? 429 : 502, { message });
  }

  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const raw = (body.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

  /*
   * NO_BASIS is a success, not an error. It means the model declined to invent
   * one — the behaviour the prompt asks for and the reason this is safe to
   * ship. The extension shows it as "your profile does not cover this yet".
   */
  const answer = raw === 'NO_BASIS' || raw.startsWith('NO_BASIS') ? '' : raw.slice(0, 2000);

  return c.json({ answer });
});
