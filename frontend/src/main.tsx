import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './App.js';

// Self-hosted via Fontsource: no request to a font CDN.
//
// This pulls in every subset's @font-face rule, but each carries a
// unicode-range, so a browser rendering English only ever downloads the latin
// woff2. The others are emitted into dist and never fetched. The latin file is
// preloaded by a plugin in vite.config.ts.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/marketing.css';
import './styles/layout.css';
import './styles/motion.css';
import './styles/blog.css';
import './styles/auth.css';
import './styles/onboarding.css';
import './styles/app.css';

const container = document.getElementById('root')!;

const app = (
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>
);

// Prerendered routes ship real markup, so attach to it instead of throwing it
// away and re-rendering — that is what keeps the static HTML's paint.
if (container.hasChildNodes()) {
  hydrateRoot(container, app);
} else {
  createRoot(container).render(app);
}
