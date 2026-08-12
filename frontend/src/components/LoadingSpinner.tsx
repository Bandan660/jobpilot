import React from 'react';

interface LoadingSpinnerProps {
  label?: string;
  fullPage?: boolean;
}

export function LoadingSpinner({ label = 'Loading…', fullPage = false }: LoadingSpinnerProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        padding: fullPage ? '80px 20px' : '40px 20px',
        width: '100%',
        minHeight: fullPage ? '60vh' : '180px',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '48px',
          height: '48px',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {/* Outer glowing pulse ring */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '2px solid var(--signal-bright)',
            opacity: 0.25,
            animation: 'spinner-pulse 1.8s cubic-bezier(0, 0.2, 0.8, 1) infinite',
          }}
        />

        {/* Rotating gradient arc */}
        <div
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            border: '3px solid transparent',
            borderTopColor: 'var(--signal-bright)',
            borderRightColor: 'var(--signal)',
            animation: 'spinner-rotate 0.8s linear infinite',
          }}
        />

        {/* Inner brand emblem mark */}
        <div
          style={{
            position: 'absolute',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: 'var(--signal-bright)',
            boxShadow: '0 0 12px var(--signal-bright)',
          }}
        />
      </div>

      {label && (
        <span
          style={{
            fontSize: '13.5px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            color: 'var(--text-dim)',
            animation: 'spinner-fade 1.5s ease-in-out infinite alternate',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
