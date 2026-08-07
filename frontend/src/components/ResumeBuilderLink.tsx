import { RESUME_BUILDER_NAME, resumeBuilderUrl } from '../content/resumeBuilder.js';
import { ExternalIcon } from './icons.js';

/**
 * Outbound link to HireFresher.
 *
 * Shared so the target attributes, the icon, and the screen-reader warning stay
 * identical everywhere. Four call sites hand-rolling an anchor is four chances
 * to forget `rel="noopener"` or to leave a keyboard user wondering why their
 * back button stopped working.
 */
export function ResumeBuilderLink({
  path,
  medium,
  className,
  children,
}: {
  path: '/' | '/resume/new' | '/ats-checker';
  medium: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={resumeBuilderUrl(path, medium)}
      target="_blank"
      // noopener only. Not nofollow: this is our own site and the link should
      // pass authority to it.
      rel="noopener"
      className={className}
    >
      {children}
      <ExternalIcon className="external-icon" />
      {/* The icon is decorative, so the warning has to be real text. */}
      <span className="sr-only"> (opens {RESUME_BUILDER_NAME} in a new tab)</span>
    </a>
  );
}
