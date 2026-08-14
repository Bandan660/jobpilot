import { FaLinkedin } from 'react-icons/fa6';
import { SiGlassdoor, SiGreenhouse, SiIndeed, SiMonster } from 'react-icons/si';
import { jobSource, type JobSourceKey } from '../jobSource.js';
import type { AtsProvider } from '@jobpilot/shared';

/**
 * Where this application was made, as a mark and a name.
 *
 * WHY SOME OF THESE ARE NOT BRAND ICONS
 *
 * react-icons carries LinkedIn, Indeed, Glassdoor, Monster and Greenhouse.
 * It does not carry Naukri — and Naukri is one of the three platforms the
 * first release ships enabled, so this cannot simply skip what it has no logo
 * for. Drawing an approximation of a company's mark is worse than not drawing
 * it: a wrong logo is a claim about someone else's brand.
 *
 * So anything without a real mark gets a lettermark, which is the convention
 * this table already uses for companies (`Avatar`). It reads as deliberate
 * beside a logo rather than as something that failed to load, and the name is
 * next to it either way — the name is what the user is actually reading.
 */
const BRAND: Partial<Record<JobSourceKey, React.ComponentType>> = {
  linkedin: FaLinkedin,
  indeed: SiIndeed,
  glassdoor: SiGlassdoor,
  monster: SiMonster,
  greenhouse: SiGreenhouse,
};

export function SourceMark({
  jobUrl,
  ats,
}: {
  jobUrl: string | null;
  ats: AtsProvider | null;
}): React.ReactElement | null {
  const source = jobSource(jobUrl, ats);
  if (!source) return null;

  const Brand = BRAND[source.key];

  return (
    <span className="meta-item source-mark" data-source={source.key}>
      {Brand ? (
        <Brand />
      ) : (
        <span className="source-letter" aria-hidden="true">
          {source.label.charAt(0).toUpperCase()}
        </span>
      )}
      {source.label}
    </span>
  );
}
