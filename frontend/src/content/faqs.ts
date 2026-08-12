export interface Faq {
  q: string;
  a: string[];
}

/**
 * Lives in content/ rather than inside a page component because the FAQ is now
 * a section of the home page — keeping the copy separate means it can be moved
 * or reused without dragging layout along with it.
 */
export const FAQS: Faq[] = [
  {
    q: 'Which job boards does this work on?',
    a: [
      'Greenhouse, Lever, and Ashby today, for both autofill and capture. Each platform needs its own adapter, so coverage grows one at a time rather than all at once.',
      'Workday, iCIMS, and SmartRecruiters are queued. If you apply somewhere unsupported, you can still add the role by hand from the tracker.',
    ],
  },
  {
    q: 'Does it fill in applications for me?',
    a: [
      'Yes. You fill in one profile — contact details, links, work history, work authorization, notice period, salary expectation — and Copilot maps it onto whatever the form calls those things.',
      'It also learns the open-ended questions. Save an answer to "why do you want to work here?" once, and Copilot recognises the same question on the next application even when it is worded differently.',
      'It never submits. Autofill puts the values in front of you and stops there.',
    ],
  },
  {
    q: 'What will autofill never touch?',
    a: [
      'Passwords, card numbers, bank details, social security and national insurance numbers, passport numbers, and dates of birth are refused outright — regardless of how the field is labelled.',
      'Voluntary self-identification questions (gender, ethnicity, veteran and disability status) are off by default. They are only filled if you explicitly turn that group on, and you can leave any of them blank.',
      'It also never overwrites something you already typed unless you tick the box asking it to.',
    ],
  },
  {
    q: 'What happens if it fills something in wrong?',
    a: [
      'Every field it changes is briefly outlined so you can see what moved, and the form is left for you to review before submitting.',
      'The matcher is deliberately cautious: if it is not confident which profile value a field wants, it leaves the field alone. A blank you notice is better than a wrong answer you do not.',
    ],
  },
  {
    q: 'Does the extension read every page I visit?',
    a: [
      'No. It only runs on the job boards listed in its permissions, and it does nothing on those pages until you apply, ask it to fill, or explicitly save a posting.',
      'It has no access to your browsing history, other tabs, or any site outside that list.',
    ],
  },
  {
    q: 'How does it know I actually applied?',
    a: [
      'It watches for a form submission that collects a resume or an email address, and for the confirmation message that appears afterwards.',
      'The test is deliberately strict. A missed capture takes one click to fix from the popup; a false one quietly puts a job you never applied to into your tracker, which is worse.',
    ],
  },
  {
    q: 'What does "posting went down" actually mean?',
    a: [
      'Every few hours BanApply re-checks the postings you are still waiting on. If the page returns a 404 or 410, or the page itself says applications are closed, the posting is marked as down.',
      'That usually means the role was filled or the req was frozen. It does not mean you were rejected — and it is a good moment to follow up.',
      'Rate limits, bot walls, and server errors are never treated as evidence. Only definitive signals count.',
    ],
  },
  {
    q: 'Why did it warn me about a duplicate when the jobs are different?',
    a: [
      'Matching is intentionally lenient. The same opening often appears at several URLs with different titles, so the matcher strips tracking parameters, requisition ids, and location suffixes before comparing.',
      'That occasionally flags two genuinely different roles at one company. It is only ever a warning — nothing is merged or blocked, and you can apply anyway.',
    ],
  },
  {
    q: 'Can I get my data out?',
    a: [
      'Yes. Export is a requirement, not a feature — a tracker you cannot leave is worse than the spreadsheet it replaced.',
    ],
  },
];
