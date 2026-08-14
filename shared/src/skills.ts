import { totalExperienceMonths } from './profile.js';

/**
 * Skills matching without a model.
 *
 * WHY NOT THE MODEL
 *
 * `POST /api/analyze` does this with Gemini and reads prose better than any
 * dictionary can. It also costs a call per posting on a free tier that runs
 * out, sends the posting and the candidate's history to a third party, and
 * takes seconds. For "which of the things this posting names do I have", none
 * of that buys anything: the answer is a set intersection, and a set
 * intersection should be instant, free, offline and the same every time.
 *
 * WHAT IT CANNOT DO
 *
 * It only recognises skills it has a name for. A posting asking for
 * "experience with distributed consensus" gets nothing from this, and a
 * candidate whose strength is judgement rather than tooling scores badly. The
 * number is the share of *named, recognised* requirements evidenced — narrower
 * than "how good a fit am I", and the wording in the UI says so.
 *
 * THE SHORT-NAME TRAP
 *
 * Some languages are named after ordinary English words: Go, R, Swift.
 * Matching "Go" against "you will go far here" invents a requirement the
 * posting never stated, and shows a missing-skill chip for a language nobody
 * asked about. Those three are listed only under unambiguous spellings —
 * "Golang", "R programming", "SwiftUI" — so a bare "Go" is not matched at all.
 * A miss is cheap; an invented requirement is not.
 *
 * The same trap caught "js" as an alias for JavaScript: it matched the ".js"
 * in "Next.js" and "Node.js", so every posting mentioning either appeared to
 * require JavaScript separately, and the score moved because of it. Two-letter
 * aliases are not worth their reach.
 */

/**
 * Canonical name -> every spelling that means it.
 *
 * The list is complete and authoritative: the canonical name is NOT added
 * automatically. That is the whole short-name defence — auto-adding put "go"
 * straight back in and undid the careful entry above it.
 */
const SKILLS: Record<string, string[]> = {
  /* Languages */
  JavaScript: ['javascript', 'ecmascript', 'es6'],
  TypeScript: ['typescript'],
  Python: ['python'],
  Java: ['java'],
  'C#': ['c#', 'csharp', 'c sharp'],
  'C++': ['c++', 'cpp'],
  Go: ['golang', 'go lang'],
  Rust: ['rust', 'rustlang'],
  Ruby: ['ruby'],
  PHP: ['php'],
  Swift: ['swiftui', 'swift ui', 'swift programming', 'swift developer'],
  Kotlin: ['kotlin'],
  Scala: ['scala'],
  R: ['r programming', 'r language'],
  SQL: ['sql'],
  Bash: ['bash', 'shell scripting'],
  'Objective-C': ['objective-c', 'objective c'],
  Dart: ['dart'],
  Elixir: ['elixir'],

  /* Front end */
  React: ['react', 'react.js', 'reactjs'],
  'Next.js': ['next.js', 'nextjs'],
  Vue: ['vue', 'vue.js', 'vuejs'],
  Nuxt: ['nuxt', 'nuxt.js'],
  Angular: ['angular', 'angularjs'],
  Svelte: ['svelte', 'sveltekit'],
  'React Native': ['react native'],
  Flutter: ['flutter'],
  Redux: ['redux'],
  HTML: ['html', 'html5'],
  CSS: ['css', 'css3'],
  Sass: ['sass', 'scss'],
  'Tailwind CSS': ['tailwind', 'tailwindcss', 'tailwind css'],
  Bootstrap: ['bootstrap'],
  Webpack: ['webpack'],
  Vite: ['vite'],
  jQuery: ['jquery'],
  Accessibility: ['accessibility', 'a11y', 'wcag'],
  'Responsive design': ['responsive design', 'responsive web'],

  /* Back end */
  'Node.js': ['node.js', 'nodejs', 'node js'],
  Express: ['express', 'express.js', 'expressjs'],
  NestJS: ['nestjs', 'nest.js'],
  Django: ['django'],
  Flask: ['flask'],
  FastAPI: ['fastapi'],
  'Spring Boot': ['spring boot', 'springboot'],
  Laravel: ['laravel'],
  Rails: ['ruby on rails', 'rails'],
  '.NET': ['.net', 'dotnet', 'asp.net'],
  GraphQL: ['graphql'],
  REST: ['rest api', 'rest apis', 'restful'],
  gRPC: ['grpc'],
  Microservices: ['microservice', 'microservices'],
  WebSockets: ['websocket', 'websockets', 'socket.io'],

  /* Data */
  PostgreSQL: ['postgresql', 'postgres'],
  MySQL: ['mysql'],
  MongoDB: ['mongodb', 'mongo'],
  Redis: ['redis'],
  Elasticsearch: ['elasticsearch', 'elastic search'],
  DynamoDB: ['dynamodb'],
  Cassandra: ['cassandra'],
  SQLite: ['sqlite'],
  Prisma: ['prisma'],
  Kafka: ['kafka'],
  RabbitMQ: ['rabbitmq'],
  Spark: ['apache spark', 'pyspark'],
  Airflow: ['airflow'],
  ETL: ['etl', 'elt'],
  'Data modelling': ['data modeling', 'data modelling'],
  Pandas: ['pandas'],
  NumPy: ['numpy'],

  /* Cloud and infrastructure */
  AWS: ['aws', 'amazon web services'],
  Azure: ['azure'],
  GCP: ['gcp', 'google cloud'],
  Docker: ['docker'],
  Kubernetes: ['kubernetes', 'k8s'],
  Terraform: ['terraform'],
  Ansible: ['ansible'],
  'CI/CD': ['ci/cd', 'continuous integration', 'continuous delivery'],
  Jenkins: ['jenkins'],
  'GitHub Actions': ['github actions'],
  Serverless: ['serverless', 'aws lambda', 'cloud functions'],
  Cloudflare: ['cloudflare'],
  Nginx: ['nginx'],
  Linux: ['linux', 'unix'],
  Observability: ['prometheus', 'grafana', 'datadog', 'observability'],

  /* Practice */
  Git: ['git', 'version control'],
  Agile: ['agile', 'scrum', 'kanban'],
  Testing: ['unit testing', 'unit tests', 'jest', 'pytest', 'vitest', 'test coverage'],
  'E2E testing': ['cypress', 'playwright', 'selenium', 'end-to-end testing'],
  TDD: ['tdd', 'test driven development', 'test-driven development'],
  'Code review': ['code review', 'code reviews'],
  'System design': ['system design', 'distributed systems', 'scalability'],
  Security: ['owasp', 'penetration testing', 'application security', 'appsec'],
  'Performance tuning': [
    'performance optimization',
    'performance optimisation',
    'performance tuning',
  ],

  /* AI and ML */
  'Machine learning': ['machine learning', 'ml models'],
  'Deep learning': ['deep learning', 'neural network', 'neural networks'],
  TensorFlow: ['tensorflow'],
  PyTorch: ['pytorch'],
  LLMs: ['llm', 'llms', 'large language model', 'openai api', 'prompt engineering'],
  NLP: ['nlp', 'natural language processing'],
  'Computer vision': ['computer vision', 'opencv'],

  /* Product and design */
  Figma: ['figma'],
  'UI/UX': ['ui/ux', 'user experience', 'ux design'],
  SEO: ['seo', 'search engine optimization', 'search engine optimisation'],
  Analytics: ['google analytics', 'mixpanel', 'amplitude'],
};

/** Escapes a literal for use inside a regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A boundary-safe matcher for one alias.
 *
 * `\b` is useless against names ending in punctuation — `\bc\+\+\b` never
 * matches "C++", because there is no word character after the `+` for the
 * boundary to sit against. The lookarounds below test for "not flanked by a
 * letter or digit" instead, which is what was meant and works for ".NET",
 * "C#" and "Node.js" alike, while still keeping "java" out of "javascript".
 */
function aliasPattern(alias: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escape(alias)}(?![a-z0-9])`, 'i');
}

const COMPILED: { canonical: string; patterns: RegExp[] }[] = Object.entries(SKILLS).map(
  ([canonical, aliases]) => ({
    canonical,
    patterns: aliases
      .filter((value, index, all) => all.indexOf(value) === index)
      .map(aliasPattern),
  })
);

/** Every recognised skill named anywhere in the text. */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];

  for (const { canonical, patterns } of COMPILED) {
    if (patterns.some((pattern) => pattern.test(text))) found.push(canonical);
  }

  return found;
}

/**
 * How worth applying this looks, in a word.
 *
 * The number alone answers "how much overlap"; it does not answer the question
 * people actually have, which is "is this worth my afternoon". 62% with every
 * must-have held is a different situation from 62% with two of them missing,
 * and the percentage cannot tell them apart.
 *
 * It is a band and not a probability. Nothing here can see the other
 * applicants, the budget, the referral the role is already promised to, or
 * whether it is still open — so "72% chance" would be a number with nothing
 * behind it, and the cost of inventing it is someone skipping a job they were
 * right for. A band says how well the evidence lines up, which is the most
 * that is true.
 */
export type FitBand = 'strong' | 'fair' | 'weak';

export interface ExperienceFit {
  /** Years the posting asks for, when it says so plainly. */
  wanted: number | null;
  /** Years the profile evidences, from its experience dates. */
  held: number | null;
  /**
   * `null` when either side is unknown — which is most postings. Absence of a
   * stated requirement is not a pass and not a fail, and rendering it as
   * either would invent a fact.
   */
  meets: boolean | null;
}

export interface SkillMatch {
  /**
   * Share of the posting's recognised requirements the profile evidences,
   * weighted by how firmly each was asked for. Still overlap, never odds.
   */
  score: number;
  /** Recognised requirements the profile evidences. */
  matched: string[];
  /** Recognised requirements it does not. */
  missing: string[];
  /**
   * Named only under a nice-to-have heading, and held. A genuine plus, shown
   * as one — but kept out of the score, because scoring above 100% of what a
   * posting requires is not a thing.
   */
  bonus: string[];
  /** Named only under a nice-to-have heading, and not held. Costs nothing. */
  preferred: string[];
  /**
   * Requirements the posting insisted on — "must have", "strong experience
   * in", "expert in". A subset of `matched` + `missing`, weighted double in
   * the score, because a posting that says a thing twice as firmly means it.
   */
  mustHave: string[];
  /** The must-haves not evidenced. Empty is what separates a strong fit. */
  missingMustHave: string[];
  /** How worth applying this looks. See `FitBand`. */
  band: FitBand;
  /** Years asked for against years evidenced. Beside the score, never inside it. */
  experience: ExperienceFit;
  /** Years the posting asks for, when it says so plainly. */
  yearsWanted: number | null;
}

/**
 * Headings that open an optional section, and headings that close one.
 *
 * Checked against short lines only. A heading is a few words on its own line;
 * the same words inside a paragraph are prose, and treating "we have a strong
 * preference for candidates who…" as a section break would silently drop the
 * rest of the requirements out of the score.
 *
 * Optional is tested first on purpose: "Preferred Qualifications" matches both
 * lists, and it is an optional section.
 */
const OPTIONAL_HEADING =
  /\b(nice[\s-]*to[\s-]*haves?|good[\s-]*to[\s-]*haves?|preferred|bonus|desirable|advantageous|pluses|optional)\b/i;

const REQUIRED_HEADING =
  /\b(requirements?|required|responsibilities|qualifications|must[\s-]*haves?|what you.{0,3}ll do|what you.{0,3}ll bring|about you|who you are|your role|the role|key skills|essential)\b/i;

/**
 * The same idea inline, for the posting that never writes a heading at all.
 *
 * "Experience with Kafka is a plus" is one optional requirement in the middle
 * of a required list, and it is by far the commonest way this is expressed.
 * Scoped to the line it appears on, so it marks that bullet optional without
 * moving the section.
 */
const INLINE_OPTIONAL =
  /\b(is a plus|are a plus|a strong plus|nice to have|good to have|bonus points|would be a bonus|but not required)\b/i;

/**
 * A line that is not asking politely.
 *
 * Postings do not weight their own requirements, but they signal them: "must
 * have Python" and "exposure to Python" are not the same demand, and a flat
 * average of every named skill treats them as though they were. A candidate
 * holding both must-haves and missing three tools mentioned once scored the
 * same as one who had it exactly the other way round, which is the comparison
 * the number exists to make.
 *
 * Scoped to the line the cue appears on. A "Requirements:" heading does not
 * make every skill under it a must-have — that heading is why they are in the
 * required bucket at all, and counting it twice would weight the whole list
 * equally again, which is where this started.
 */
const MUST_HAVE_CUE =
  /\b(must[\s-]*have|must possess|is required|are required|mandatory|essential|non[\s-]*negotiable|strong (?:experience|background|knowledge|command|grasp)|expert(?:ise)? (?:in|with)|proficien(?:t|cy) (?:in|with)|deep (?:experience|knowledge|understanding)|solid (?:experience|understanding)|advanced (?:knowledge|experience)|extensive experience)\b/i;

/** Weight of a requirement the posting insisted on, against one it merely named. */
const MUST_HAVE_WEIGHT = 2;
const NAMED_WEIGHT = 1;

/** A heading is short. A paragraph that happens to contain the word is not. */
const MAX_HEADING_LENGTH = 80;

/**
 * Short is not enough on its own.
 *
 * "Preferred candidate should be an immediate joiner based in Hyderabad" is 67
 * characters and not a heading, and treating it as one moves every line after
 * it into the optional bucket. A real heading either ends in a colon or is a
 * handful of words; requiring one of those keeps a sentence from silently
 * closing the requirements list.
 */
function looksLikeHeading(line: string): boolean {
  if (line.length > MAX_HEADING_LENGTH) return false;
  return line.endsWith(':') || line.split(/\s+/).length <= 5;
}

/**
 * Split a posting into what it demands and what it merely likes.
 *
 * Without this every "nice to have" counted as a requirement at full weight,
 * and the effect was not small: a candidate holding all thirteen hard
 * requirements of a posting that also listed four optional extras scored 59%
 * rather than 77%, and four chips reading "Not in your profile" pointed at
 * things the posting had explicitly said were not needed. The number that
 * matters is overlap with what is actually required.
 */
export function splitRequirements(text: string): { required: string; optional: string } {
  const required: string[] = [];
  const optional: string[] = [];
  let inOptional = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (looksLikeHeading(trimmed)) {
      if (OPTIONAL_HEADING.test(trimmed)) {
        inOptional = true;
        optional.push(trimmed);
        continue;
      }

      if (REQUIRED_HEADING.test(trimmed)) {
        inOptional = false;
        required.push(trimmed);
        continue;
      }
    }

    // A line that says it is optional is optional wherever it sits, and does
    // not drag the lines after it along with it.
    if (!inOptional && INLINE_OPTIONAL.test(trimmed)) {
      optional.push(trimmed);
      continue;
    }

    (inOptional ? optional : required).push(trimmed);
  }

  return { required: required.join('\n'), optional: optional.join('\n') };
}

/**
 * "5+ years", "at least 3 years", "3-5 years of experience".
 *
 * Takes the smallest number stated, because a posting saying "3-5 years" is
 * describing a floor of three. Ignores anything above 30, which is a salary,
 * a headcount or a founding date rather than a career.
 */
export function yearsRequired(text: string): number | null {
  const matches = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/gi)];
  const years = matches
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 30);

  return years.length ? Math.min(...years) : null;
}

/**
 * Every recognised skill named on a line the posting insisted on.
 *
 * Deliberately re-extracted per line rather than "does this skill appear
 * anywhere near a cue": a bullet reading "must have strong Python; exposure to
 * Go a plus" states two different demands, and only the first is a must-have.
 */
export function mustHaveSkills(requiredText: string): Set<string> {
  const found = new Set<string>();

  for (const line of requiredText.split('\n')) {
    if (!MUST_HAVE_CUE.test(line)) continue;
    for (const skill of extractSkills(line)) found.add(skill);
  }

  return found;
}

export interface MatchableProfile {
  skills?: string[] | null;
  experience?:
    | {
        title?: string | null;
        description?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        current?: boolean;
      }[]
    | null;
  /**
   * The resume, as text. Where most of the evidence actually is — the skills
   * list is a summary typed once, the resume names the tools of every project
   * shipped. See `Profile.resumeText`.
   */
  resumeText?: string | null;
}

/**
 * Years of work the profile evidences, or null when its dates do not say.
 *
 * Null rather than zero on purpose: "no dates entered" and "no experience" are
 * different claims, and showing a fresher's zero against someone who simply
 * has not filled in a start date is the kind of wrong that gets a real posting
 * dismissed.
 */
function yearsHeld(profile: MatchableProfile): number | null {
  const roles = (profile.experience ?? []).filter((role) => role.startDate);
  if (roles.length === 0) return null;
  return Math.floor(totalExperienceMonths({ experience: roles }) / 12);
}

/**
 * Compare a posting against a profile.
 *
 * Evidence for a skill is the skills list, the text of any role, *or* the
 * resume — someone who shipped React for three years and never added it to
 * their skills list has the skill, and a matcher that says otherwise is wrong
 * in the direction that costs the user an application.
 */
export function matchSkills(description: string, profile: MatchableProfile): SkillMatch {
  const sections = splitRequirements(description);

  let required = extractSkills(sections.required);
  let optionalText = sections.optional;

  /*
   * A split that leaves nothing required is a bad split, not an empty posting.
   *
   * The sectioning is a heuristic over free text and it has exactly one
   * catastrophic failure: put every skill the posting names into the optional
   * bucket and the card reports "No skills named in this posting that jobpilot
   * recognises" over a posting full of them. Four ordinary shapes did it —
   * "Preferred skills:" with no requirements heading after it, everything
   * under "Bonus:", a lone "Desirable profile:" — because `inOptional` stays
   * set until something turns it off, and nothing has to.
   *
   * So the heuristic is allowed to refine the score, never to erase it. If it
   * classified everything as optional, it learned nothing, and the whole
   * posting is read as requirements the way it was before any of this.
   */
  if (required.length === 0) {
    required = extractSkills(description);
    optionalText = '';
  }

  /*
   * Optional *only*. A skill named in both lists is a requirement that the
   * posting also happened to mention under "nice to have" — the stronger
   * statement wins, and it stays in the score.
   */
  const requiredSet = new Set(required);
  const optional = extractSkills(optionalText).filter((skill) => !requiredSet.has(skill));

  const evidence = [
    ...(profile.skills ?? []),
    ...(profile.experience ?? []).flatMap((role) => [role.title ?? '', role.description ?? '']),
    profile.resumeText ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const held = new Set(extractSkills(evidence));

  const matched = required.filter((skill) => held.has(skill));
  const missing = required.filter((skill) => !held.has(skill));
  const bonus = optional.filter((skill) => held.has(skill));
  const preferred = optional.filter((skill) => !held.has(skill));

  /*
   * Must-haves are read off the required text only. A skill the posting
   * insisted on under a "nice to have" heading is a contradiction the posting
   * made, and the optional bucket already resolves it the same way: the
   * stronger statement wins.
   */
  const insisted = mustHaveSkills(sections.required);
  const mustHave = required.filter((skill) => insisted.has(skill));
  const missingMustHave = mustHave.filter((skill) => !held.has(skill));

  const weightOf = (skill: string): number =>
    insisted.has(skill) ? MUST_HAVE_WEIGHT : NAMED_WEIGHT;
  const total = required.reduce((sum, skill) => sum + weightOf(skill), 0);
  const earned = matched.reduce((sum, skill) => sum + weightOf(skill), 0);

  /*
   * Zero when the posting named nothing recognisable. Callers check
   * `matched.length + missing.length` before showing a score, because "0%" and
   * "we could not read this posting" are very different messages and only one
   * of them is true.
   */
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);

  const wanted = yearsRequired(description);
  const heldYears = yearsHeld(profile);

  return {
    bonus,
    preferred,
    score,
    matched,
    missing,
    mustHave,
    missingMustHave,
    band: fitBand(score, missingMustHave.length),
    experience: {
      wanted,
      held: heldYears,
      meets: wanted === null || heldYears === null ? null : heldYears >= wanted,
    },
    yearsWanted: wanted,
  };
}

/**
 * Coverage plus must-haves, in a word.
 *
 * The thresholds are judgement, not measurement, and they are set where the
 * advice changes rather than at round numbers: below 40% of a posting's
 * weighted requirements the application is a long shot however it is dressed
 * up, and a missing must-have caps it at "worth applying" no matter how high
 * the coverage — a 90% match missing the one thing the posting called
 * essential is not a strong fit, and calling it one would be the number
 * lying on the user's behalf.
 */
export function fitBand(score: number, missingMustHaveCount: number): FitBand {
  if (score >= 70 && missingMustHaveCount === 0) return 'strong';
  if (score >= 40 || (score >= 25 && missingMustHaveCount === 0)) return 'fair';
  return 'weak';
}

/** The band as the panel says it. Never odds — see `FitBand`. */
export const BAND_LABEL: Record<FitBand, string> = {
  strong: 'Strong fit',
  fair: 'Worth applying',
  weak: 'Long shot',
};

/** How many skill names the dictionary knows. Used in the UI's honesty note. */
export const KNOWN_SKILL_COUNT = Object.keys(SKILLS).length;
