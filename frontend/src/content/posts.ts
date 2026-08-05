export interface Post {
  slug: string;
  title: string;
  /** Shown on cards and in search results. Keep under ~160 characters. */
  summary: string;
  date: string;
  /** Set when a post is materially revised — search engines weight freshness. */
  updated?: string;
  readingMinutes: number;
  category: string;
  author: string;
  /** Topic tags, rendered on the post and emitted in structured data. */
  tags: string[];
  body: Block[];
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: string[] };

export const POSTS: Post[] = [
  {
    slug: 'why-your-tracker-is-always-out-of-date',
    title: 'Why your job application tracker is always out of date',
    summary:
      'Every job-search spreadsheet dies the same way. The problem is not discipline — it is that logging an application happens at the worst possible moment.',
    date: '2026-07-14',
    readingMinutes: 4,
    category: 'Job search',
    author: 'jobpilot',
    tags: ['job tracking', 'spreadsheets', 'productivity'],
    body: [
      {
        kind: 'p',
        text: 'Every job search starts with a spreadsheet. Company, role, date applied, status, link. For about two weeks it is immaculate. Then it quietly stops matching reality, and a month later you are opening old confirmation emails to reconstruct where you actually stand.',
      },
      {
        kind: 'p',
        text: 'The usual explanation is discipline. That is wrong, and it is worth being precise about why, because the real reason points at the fix.',
      },
      { kind: 'h2', text: 'The cost lands at the worst moment' },
      {
        kind: 'p',
        text: 'You log an application immediately after submitting one. That is the point of maximum fatigue in the entire process — you have just retyped your work history into a form that could have parsed your resume, invented an answer to why you want to work there, and clicked submit. The very next thing the spreadsheet asks is that you switch context and do more data entry.',
      },
      {
        kind: 'p',
        text: 'So you skip it, once. And the tracker is now wrong, which makes it less trustworthy, which makes updating it feel less worthwhile. That loop only runs one direction.',
      },
      { kind: 'h2', text: 'Status is the part that really rots' },
      {
        kind: 'p',
        text: 'Even a diligently logged application decays. You wrote down "applied" three weeks ago. Since then a recruiter emailed, you did a screen, and you are waiting on a take-home. None of that is in the sheet, because each update is another interruption with no immediate payoff.',
      },
      {
        kind: 'quote',
        text: 'A tracker you have to maintain is a second job you did not apply for.',
      },
      {
        kind: 'p',
        text: 'This is why the interesting problem is not building a nicer table. It is removing the moment where a human has to type something in.',
      },
      { kind: 'h2', text: 'What that means in practice' },
      {
        kind: 'list',
        items: [
          'Capture has to happen where the application happens — in the browser, at submit, with no second step.',
          'Status changes should come from evidence the system can already see, not from you remembering.',
          'The tracker should be able to tell you something you did not know, or it is just storage.',
        ],
      },
      {
        kind: 'p',
        text: 'That last point is the one most tools miss. If a tracker only ever shows you what you typed into it, the best possible outcome is an accurate list. Useful, but not worth maintaining. The version worth having notices things on your behalf.',
      },
    ],
  },
  {
    slug: 'what-a-posting-coming-down-tells-you',
    title: 'What a job posting coming down actually tells you',
    summary:
      'A posting disappearing is one of the few honest signals in a hiring process designed to give you none. Here is how to read it, and how to read it wrong.',
    date: '2026-07-28',
    readingMinutes: 3,
    category: 'Job search',
    author: 'jobpilot',
    tags: ['ghosting', 'follow-up', 'signals'],
    body: [
      {
        kind: 'p',
        text: 'After you apply, the information stops. No acknowledgement beyond an autoresponder, no timeline, no status. Silence is indistinguishable from rejection, and both are indistinguishable from a hiring manager being on holiday.',
      },
      {
        kind: 'p',
        text: 'But there is one signal still available to you, and almost nobody watches it: whether the posting is still up.',
      },
      { kind: 'h2', text: 'Three things a removal can mean' },
      {
        kind: 'list',
        items: [
          'The role was filled. The most common case, and the one that matters to you.',
          'The req was frozen or cut. Increasingly common, and you will essentially never be told.',
          'The posting was rotated or reposted. A real false positive, particularly at large companies that cycle listings.',
        ],
      },
      {
        kind: 'p',
        text: 'None of those mean you were rejected. All of them mean the thing you are waiting for has changed shape, and waiting quietly is no longer the right move.',
      },
      { kind: 'h2', text: 'The failure mode to avoid' },
      {
        kind: 'p',
        text: 'It is tempting to treat a dead posting as a rejection and close the loop. Do not. A closed posting with your application still in the pipeline is exactly the situation where a short, specific follow-up is worth sending — you have a concrete reason to write, which is more than most follow-ups can claim.',
      },
      {
        kind: 'p',
        text: 'It also matters how you detect the removal. A single failed page load is not evidence. Rate limiting, bot walls, and transient server errors all look like a missing posting if you are not careful, and inferring "dead" from a 403 will teach you to distrust the signal entirely.',
      },
      {
        kind: 'quote',
        text: 'Only definitive evidence should move the needle: a 404, a 410, or the page itself saying applications are closed.',
      },
      {
        kind: 'p',
        text: 'Checked properly, it is the closest thing to a status update the process will give you for free.',
      },
    ],
  },
  {
    slug: 'the-duplicate-application-problem',
    title: 'The duplicate application problem nobody talks about',
    summary:
      'Applying twice to the same role is more common than people admit, and the reason is structural: the same job legitimately appears at several different URLs.',
    date: '2026-08-02',
    readingMinutes: 3,
    category: 'Job search',
    author: 'jobpilot',
    tags: ['duplicates', 'ats', 'applications'],
    body: [
      {
        kind: 'p',
        text: 'Somewhere around application sixty, you will apply to a job you have already applied to. Not because you forgot the company — because you did not recognise the posting.',
      },
      { kind: 'h2', text: 'One job, many front doors' },
      {
        kind: 'p',
        text: 'A single opening is routinely reachable through the company careers page, the raw ATS board, an aggregator listing, and a recruiter link. Each carries different tracking parameters. Visually they are different pages with different titles — the aggregator may have rewritten the role name, and the ATS may append a requisition id.',
      },
      {
        kind: 'p',
        text: "From the applicant tracking system's side this is one job. From your side it looks like four, and nothing tells you otherwise until a recruiter mentions it.",
      },
      { kind: 'h2', text: 'Why matching is harder than it looks' },
      {
        kind: 'list',
        items: [
          'URLs need canonicalising, but you cannot simply strip query strings — some systems put the job id there.',
          'Company names arrive as "Acme", "Acme, Inc.", and "acme-labs" depending on the source.',
          'Titles pick up noise: "(Remote)", "- New York", "#R4821", "Sr." versus "Senior".',
        ],
      },
      {
        kind: 'p',
        text: 'Normalisation has to be lenient enough to catch these, which means it will occasionally match two genuinely different roles at the same company. That is the right trade — as a warning shown before you apply, a false positive costs you one glance, while a miss costs you a duplicate application and a slightly awkward conversation.',
      },
      {
        kind: 'quote',
        text: 'The asymmetry decides the design: warn liberally, merge never.',
      },
      {
        kind: 'p',
        text: 'What you must not do is quietly merge records on a fuzzy match. Two similar titles at one company are frequently two real, distinct openings, and silently collapsing them destroys information the applicant cannot recover.',
      },
    ],
  },
  {
    slug: 'how-to-follow-up-on-a-job-application',
    title: 'How to follow up on a job application without being annoying',
    summary:
      'Most follow-up advice is about tone. The thing that actually decides whether a follow-up works is whether you have a reason to be writing at all.',
    date: '2026-08-04',
    readingMinutes: 5,
    category: 'Applying',
    author: 'jobpilot',
    tags: ['follow-up', 'recruiters', 'email'],
    body: [
      {
        kind: 'p',
        text: 'The standard advice is to follow up after one week, then again after two, politely and briefly. It is not wrong, but it misses the thing that actually determines whether a follow-up lands: whether you have a reason to be writing beyond the passage of time.',
      },
      {
        kind: 'p',
        text: '"Just checking in" tells a recruiter nothing they did not already know, and it arrives in an inbox that receives dozens of them a week. A follow-up with a concrete trigger is a different message entirely.',
      },
      { kind: 'h2', text: 'Wait for a reason, not a date' },
      {
        kind: 'p',
        text: 'Good reasons to write are events, not intervals:',
      },
      {
        kind: 'list',
        items: [
          'The posting came down. The role is likely filled or frozen — asking directly is reasonable and gets you a real answer more often than a timed nudge.',
          'The company announced something relevant: a funding round, a launch, a reorg in the team you applied to.',
          'You shipped something related since applying. A new project, a talk, a piece of writing.',
          'A stated timeline passed. If they told you two weeks and it has been three, you are quoting them, not nagging.',
        ],
      },
      {
        kind: 'p',
        text: 'Each of those gives the first line of the email something to do other than apologise for existing.',
      },
      { kind: 'h2', text: 'Write it in four sentences' },
      {
        kind: 'p',
        text: 'Recruiters triage. A follow-up that takes more than about fifteen seconds to read gets deferred, and deferred means forgotten. The shape that works:',
      },
      {
        kind: 'list',
        items: [
          'One line naming the role and roughly when you applied, so they can find you.',
          'One line with the actual reason you are writing today.',
          'One line of new, specific information about you — not a restatement of your resume.',
          'One clear question with a yes/no answer. "Is the role still open?" beats "any updates?".',
        ],
      },
      {
        kind: 'quote',
        text: 'A question they can answer in one word is a question they can answer today.',
      },
      { kind: 'h2', text: 'Know when to stop' },
      {
        kind: 'p',
        text: 'Two follow-ups is the practical ceiling for most applications. Beyond that you are not raising your odds, you are just spending goodwill you might want later — recruiters move companies, and they remember.',
      },
      {
        kind: 'p',
        text: 'If the posting is gone and two messages have gone unanswered, treat the application as closed and put the energy into the next one. That is not giving up; it is refusing to keep a dead application on your mental books.',
      },
      { kind: 'h2', text: 'The record problem' },
      {
        kind: 'p',
        text: 'All of this assumes you know when you applied, who you spoke to, and what was said. Most people do not, because that record lives in a spreadsheet that stopped being accurate weeks ago. The follow-up advice is easy; having the facts to write a specific one is the hard part.',
      },
    ],
  },
  {
    slug: 'what-an-ats-does-with-your-application',
    title: 'What an ATS actually does with your application',
    summary:
      'Applicant tracking systems are widely misunderstood, mostly by people selling ways to beat them. Here is what Greenhouse, Lever, and Workday genuinely do.',
    date: '2026-08-06',
    readingMinutes: 6,
    category: 'How hiring works',
    author: 'jobpilot',
    tags: ['ats', 'greenhouse', 'lever', 'workday', 'resume'],
    body: [
      {
        kind: 'p',
        text: 'There is a persistent story that applicant tracking systems automatically reject most resumes before a human sees them, and that the way through is to stuff your resume with keywords. It is a good story for anyone selling a resume-optimisation product. It is mostly not true.',
      },
      { kind: 'h2', text: 'What an ATS is' },
      {
        kind: 'p',
        text: 'An ATS is a database with a workflow on top. Greenhouse, Lever, Ashby, Workday, iCIMS — they exist so a recruiting team can see every candidate for a req in one list, move them between stages, leave scorecards, and stay compliant with record-keeping rules.',
      },
      {
        kind: 'p',
        text: 'That is the product. It is bought by recruiting teams to organise their own work, not to filter you out. The candidate-facing form is a side effect of needing structured data in the database.',
      },
      { kind: 'h2', text: 'What it does when you submit' },
      {
        kind: 'list',
        items: [
          'Parses your resume into structured fields — name, contact, employers, dates, education — with middling accuracy.',
          'Creates a candidate record attached to that specific requisition.',
          'Applies any knockout questions the employer configured, such as work authorization.',
          'Puts you in a list, usually sorted by date applied.',
        ],
      },
      {
        kind: 'p',
        text: 'That last one is the part people underestimate. For most roles, the deciding factor is not a scoring algorithm; it is that a human is looking at a list of four hundred names and will realistically read sixty of them.',
      },
      { kind: 'h2', text: 'The knockout questions are the real filter' },
      {
        kind: 'p',
        text: 'Automatic rejection does happen, but it is almost always a rule the employer set explicitly: are you authorized to work in this country, will you require sponsorship, do you have the required licence, are you willing to work on site.',
      },
      {
        kind: 'p',
        text: 'These are configured deliberately and answered by you, on the form. They are not a mysterious algorithm, and they are the reason to answer those fields carefully rather than quickly.',
      },
      {
        kind: 'quote',
        text: 'Most "the ATS rejected me" stories are really "four hundred people applied and I was ninetieth in the list".',
      },
      { kind: 'h2', text: 'Where keywords do and do not matter' },
      {
        kind: 'p',
        text: 'Recruiters search the database. If a recruiter searches "Kubernetes" across their candidate pool, having the word in your resume decides whether you appear. That is a real effect, and it is a reason to use the plain, conventional name for a skill rather than a clever synonym.',
      },
      {
        kind: 'p',
        text: 'What does not happen is a score being computed against the job description and everything below a threshold being binned. Some systems offer match scores; most recruiters treat them as a sort order at best.',
      },
      { kind: 'h2', text: 'The practical takeaways' },
      {
        kind: 'list',
        items: [
          'Answer the structured questions accurately — those are the only truly automatic filters.',
          'Use conventional names for skills and titles so recruiter searches find you.',
          'Apply early. Position in the list matters more than almost anything else you control.',
          'Do not pay for keyword stuffing. Parsers are unimpressed and humans notice.',
        ],
      },
      {
        kind: 'p',
        text: 'Applying early is the one with real leverage, and it is also the one that competes directly with how long applications take to fill in. That trade — speed against effort — is the whole reason autofill exists.',
      },
    ],
  },
];

export function findPost(slug: string): Post | undefined {
  return POSTS.find((post) => post.slug === slug);
}

/** Posts sharing a tag with the given one, newest first. */
export function relatedPosts(post: Post, limit = 2): Post[] {
  return POSTS.filter((other) => other.slug !== post.slug)
    .map((other) => ({
      post: other,
      overlap: other.tags.filter((tag) => post.tags.includes(tag)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.post.date.localeCompare(a.post.date))
    .slice(0, limit)
    .map((entry) => entry.post);
}

// Re-exported from shared so posts, the dashboard, and the legal pages all
// render dates identically — and so nothing here formats with a locale that
// would differ between the prerender and the browser.
export { formatDate } from '@jobpilot/shared';
