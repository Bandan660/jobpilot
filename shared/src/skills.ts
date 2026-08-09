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

export interface SkillMatch {
  /** Share of the posting's recognised requirements the profile evidences. */
  score: number;
  /** Recognised requirements the profile evidences. */
  matched: string[];
  /** Recognised requirements it does not. */
  missing: string[];
  /** Years the posting asks for, when it says so plainly. */
  yearsWanted: number | null;
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

export interface MatchableProfile {
  skills?: string[] | null;
  experience?: { title?: string | null; description?: string | null }[] | null;
}

/**
 * Compare a posting against a profile.
 *
 * Evidence for a skill is the skills list *or* the text of any role — someone
 * who shipped React for three years and never added it to their skills list
 * has the skill, and a matcher that says otherwise is wrong in the direction
 * that costs the user an application.
 */
export function matchSkills(description: string, profile: MatchableProfile): SkillMatch {
  const required = extractSkills(description);

  const evidence = [
    ...(profile.skills ?? []),
    ...(profile.experience ?? []).flatMap((role) => [role.title ?? '', role.description ?? '']),
  ]
    .filter(Boolean)
    .join('\n');

  const held = new Set(extractSkills(evidence));

  const matched = required.filter((skill) => held.has(skill));
  const missing = required.filter((skill) => !held.has(skill));

  return {
    /*
     * Zero when the posting named nothing recognisable. Callers check
     * `matched.length + missing.length` before showing a score, because "0%"
     * and "we could not read this posting" are very different messages and
     * only one of them is true.
     */
    score: required.length === 0 ? 0 : Math.round((matched.length / required.length) * 100),
    matched,
    missing,
    yearsWanted: yearsRequired(description),
  };
}

/** How many skill names the dictionary knows. Used in the UI's honesty note. */
export const KNOWN_SKILL_COUNT = Object.keys(SKILLS).length;
