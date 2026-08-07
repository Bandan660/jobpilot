import { useEffect, useRef, useState } from 'react';
import { MAX_RESUME_BYTES, formatDate, type Resume } from '@jobpilot/shared';
import { api } from '../../api.js';
import { ResumeBuilderLink } from '../../components/ResumeBuilderLink.js';
import { FileTextIcon } from '../../components/icons.js';

/**
 * Resume manager.
 *
 * Files live in object storage and are never publicly addressable — every
 * download goes through an authenticated endpoint, so there is no URL to share
 * accidentally or leak in a referrer.
 */
export function Resumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .listResumes()
      .then(({ resumes: list }) => setResumes(list))
      .catch(() => setError('Could not load your resumes'))
      .finally(() => setLoading(false));
  }, []);

  async function upload(file: File) {
    setError(null);

    // Checked here as well as on the server so an oversized file is refused
    // before it is uploaded, not after.
    if (file.size > MAX_RESUME_BYTES) {
      setError(`That file is larger than ${Math.round(MAX_RESUME_BYTES / 1024 / 1024)}MB.`);
      return;
    }

    setBusy(true);
    try {
      const { resume } = await api.uploadResume(file);
      // A first upload becomes the default server-side, so refetch rather than
      // guessing which flags changed.
      setResumes(await api.listResumes().then((r) => r.resumes));
      void resume;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setResumes(await api.listResumes().then((r) => r.resumes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    }
  }

  return (
    <section className="panel form-group">
      <div className="form-group-head">
        <div className="group-title">
          <span className="tile-icon tile-icon-sm" data-tone="c">
            <FileTextIcon />
          </span>
          <h2>Resumes</h2>
        </div>
        <p className="muted">
          Attached to applications so you can tell later which version you sent. Stored privately —
          only you can download them.
        </p>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : resumes.length === 0 ? (
        <>
          <p className="muted">Nothing uploaded yet.</p>
          {/* Names the audience, so someone it does not fit can skip it rather
              than bouncing off a page that was never meant for them. */}
          <p className="muted cross-promo">
            Need one?{' '}
            <ResumeBuilderLink path="/resume/new" medium="profile_resumes">
              Build a free ATS-friendly resume on HireFresher
            </ResumeBuilderLink>
            , our separate builder aimed at freshers in India.
          </p>
        </>
      ) : (
        <ul className="entry-list">
          {resumes.map((resume) => (
            <li key={resume.id}>
              <div>
                <strong>
                  {resume.fileName}
                  {resume.isDefault && <span className="lamp lamp-live default-tag">default</span>}
                </strong>
                <p className="muted">
                  {(resume.sizeBytes / 1024).toFixed(0)} KB · uploaded{' '}
                  {formatDate(resume.uploadedAt)}
                </p>
              </div>

              <div className="entry-actions">
                <button
                  className="btn-link"
                  onClick={() => void api.downloadResume(resume.id, resume.fileName)}
                >
                  Download
                </button>
                {!resume.isDefault && (
                  <button className="btn-link" onClick={() => void act(() => api.setDefaultResume(resume.id))}>
                    Make default
                  </button>
                )}
                <button
                  className="btn-link danger"
                  onClick={() => void act(() => api.deleteResume(resume.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error-text">{error}</p>}

      <div>
        <input
          ref={input}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button className="btn btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : 'Upload a resume'}
        </button>
        <p className="muted upload-hint">
          PDF or Word, up to 10MB.{' '}
          <ResumeBuilderLink path="/ats-checker" medium="profile_ats">
            Check how it scores against an ATS
          </ResumeBuilderLink>
        </p>
      </div>
    </section>
  );
}
