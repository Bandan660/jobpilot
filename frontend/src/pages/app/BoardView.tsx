import { useState } from 'react';
import { daysBetween, type Application, type ApplicationStatus } from '@jobpilot/shared';
import { BuildingIcon, PinIcon } from '../../components/icons.js';

/**
 * Board view.
 *
 * Columns are statuses, so dragging a card between them is the status change —
 * no dropdown, no save. Uses the native drag-and-drop API rather than a
 * library: the whole interaction is dragstart, dragover and drop, and a
 * board is not worth 30KB.
 *
 * ACCESSIBILITY: native drag-and-drop is mouse-only and has no keyboard
 * equivalent. That is why the list view keeps its status dropdown and stays
 * the default — the board is a faster way to do something that remains fully
 * possible without it, not the only way.
 */

const COLUMNS: { status: ApplicationStatus; label: string; tone: string }[] = [
  { status: 'SAVED', label: 'Saved', tone: 'wait' },
  { status: 'APPLIED', label: 'Applied', tone: 'wait' },
  { status: 'SCREEN', label: 'Screen', tone: 'live' },
  { status: 'INTERVIEW', label: 'Interview', tone: 'live' },
  { status: 'OFFER', label: 'Offer', tone: 'signal' },
  { status: 'REJECTED', label: 'Rejected', tone: 'down' },
];

export function BoardView({
  applications,
  onMove,
}: {
  applications: Application[];
  onMove: (id: string, status: ApplicationStatus) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);

  function drop(status: ApplicationStatus) {
    setOver(null);
    if (!dragging) return;

    const app = applications.find((a) => a.id === dragging);
    setDragging(null);
    // Dropping a card back where it started is not a change.
    if (!app || app.status === status) return;

    onMove(app.id, status);
  }

  return (
    <div className="board">
      {COLUMNS.map((column) => {
        const cards = applications.filter((a) => a.status === column.status);

        return (
          <section
            key={column.status}
            className="board-col"
            data-over={over === column.status}
            onDragOver={(e) => {
              // Without preventDefault the browser refuses the drop entirely.
              e.preventDefault();
              setOver(column.status);
            }}
            onDragLeave={() => setOver((c) => (c === column.status ? null : c))}
            onDrop={() => drop(column.status)}
          >
            <header className="board-col-head">
              <span className="board-dot" data-tone={column.tone} />
              <h3>{column.label}</h3>
              <span className="board-count">{cards.length}</span>
            </header>

            <div className="board-cards">
              {cards.map((app) => (
                <Card
                  key={app.id}
                  app={app}
                  dragging={dragging === app.id}
                  onDragStart={() => setDragging(app.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}

              {cards.length === 0 && (
                <p className="board-empty">{over === column.status ? 'Drop here' : 'Nothing here'}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card({
  app,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  app: Application;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const silent =
    app.status === 'APPLIED' && !app.firstResponseAt && app.appliedAt
      ? daysBetween(app.appliedAt)
      : null;

  return (
    <article
      className="board-card"
      draggable
      data-dragging={dragging}
      onDragStart={(e) => {
        // Firefox will not start a drag unless data is set.
        e.dataTransfer.setData('text/plain', app.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="board-card-head">
        {app.jobUrl ? (
          <a href={app.jobUrl} target="_blank" rel="noreferrer noopener">
            {app.title}
          </a>
        ) : (
          <span>{app.title}</span>
        )}
        {app.starred && <span className="board-star">★</span>}
      </div>

      <div className="board-card-meta">
        <span className="meta-item">
          <BuildingIcon />
          {app.company.name}
        </span>
        {app.location && (
          <span className="meta-item">
            <PinIcon />
            {app.location}
          </span>
        )}
      </div>

      {(app.postingStatus === 'REMOVED' || app.postingStatus === 'CLOSED' || (silent ?? 0) >= 10) && (
        <div className="board-card-flags">
          {(app.postingStatus === 'REMOVED' || app.postingStatus === 'CLOSED') && (
            <span className="lamp lamp-down">{app.postingStatus.toLowerCase()}</span>
          )}
          {silent !== null && silent >= 10 && (
            <span className="lamp lamp-wait">silent {silent}d</span>
          )}
        </div>
      )}
    </article>
  );
}
