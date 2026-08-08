import { useEffect, useRef, useState } from 'react';
import { MAX_RESUME_BYTES, formatDate, type Resume } from '@jobpilot/shared';
import { api } from '../../api.js';
import { ResumeBuilderLink } from '../../components/ResumeBuilderLink.js';
import {
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  TrashIcon,
  UploadIcon,
  CloseIcon,
} from '../../components/icons.js';

/**
 * Resume manager.
 *
 * Files live in object storage and are never publicly addressable — every
 * download goes through an authenticated endpoint, so there is no URL to share
 * accidentally or leak in a referrer.
 */
/**
 * In-page viewer for a stored resume.
 *
 * A modal rather than a new tab: checking your own file is a glance, and
 * losing the page you were editing to do it is a poor trade.
 *
 * PDFs render in an iframe, which every target browser handles natively. Word
 * documents do not render anywhere without a converter, so they are offered as
 * a download instead of an empty frame that looks broken.
 */
function PreviewModal({
  resume,
  url,
  onClose,
}: {
  resume: Resume;
  url: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-screen overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const isPdf = resume.contentType === 'application/pdf';

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${resume.fileName}`}
    >
      {/* Clicks inside must not reach the backdrop's close handler. */}
      <div className="modal preview-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <strong>{resume.fileName}</strong>
          <button className="icon-action" onClick={onClose} aria-label="Close preview" title="Close">
            <CloseIcon />
          </button>
        </header>

        {isPdf ? (
          <iframe className="preview-frame" src={url} title={resume.fileName} />
        ) : (
          <div className="preview-fallback">
            <p className="muted">Word documents cannot be shown here.</p>
            <button
              className="btn btn-ghost"
              onClick={() => void api.downloadResume(resume.id, resume.fileName)}
            >
              Download to view
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Resumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ resume: Resume; url: string } | null>(null);

  // The object URL is ours to release; holding it after the viewer closes
  // pins the whole file in memory.
  const closePreview = () => {
    setPreview((open) => {
      if (open) URL.revokeObjectURL(open.url);
      return null;
    });
  };

  async function openPreview(resume: Resume) {
    setError(null);
    try {
      setPreview({ resume, url: await api.previewResume(resume.id) });
    } catch {
      setError('Could not open that file');
    }
  }

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
      setError(
        `That file is over ${Math.round(MAX_RESUME_BYTES / 1024)}KB. Re-export it as PDF, or use a "reduce file size" option — most resumes shrink well below this without looking different.`
      );
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
              <span className="entry-mark" data-file="true">
                <FileTextIcon />
              </span>
              <div className="entry-body">
                <strong>
                  {resume.fileName}

                </strong>
                <p className="muted">
                  {(resume.sizeBytes / 1024).toFixed(0)} KB · uploaded{' '}
                  {formatDate(resume.uploadedAt)}
                </p>
              </div>

              <div className="entry-actions">
                <button
                  className="icon-action"
                  onClick={() => void openPreview(resume)}
                  aria-label="Preview resume"
                  title="Preview"
                >
                  <EyeIcon />
                </button>
                <button
                  className="icon-action"
                  onClick={() => void api.downloadResume(resume.id, resume.fileName)}
                  aria-label="Download resume"
                  title="Download"
                >
                  <DownloadIcon />
                </button>

                <button
                  className="icon-action danger"
                  onClick={() => void act(() => api.deleteResume(resume.id))}
                  aria-label="Delete resume"
                  title="Delete"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <PreviewModal resume={preview.resume} url={preview.url} onClose={closePreview} />
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
          <UploadIcon />
          {busy ? 'Uploading…' : resumes.length > 0 ? 'Replace resume' : 'Upload a resume'}
        </button>
        <p className="muted upload-hint">
          PDF or Word, up to 200KB. Uploading again replaces the one you have.{' '}
          <ResumeBuilderLink path="/ats-checker" medium="profile_ats">
            Check how it scores against an ATS
          </ResumeBuilderLink>
        </p>
      </div>
    </section>
  );
}
