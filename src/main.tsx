import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { UrlExtractor } from './components/UrlExtractor';
import './app.css';

// Standalone app. `?url=` makes results shareable: it prefills the box and fetches on load.
const initialUrl = new URLSearchParams(window.location.search).get('url') ?? '';

function App() {
  return (
    <main className="app">
      <header className="app-header">
        <h1>URL Extractor</h1>
        <p>
          Find every link, image, script and stylesheet on a web page, then filter, copy or download them.
        </p>
      </header>
      <UrlExtractor
        initialUrl={initialUrl}
        autoFetch={Boolean(initialUrl)}
        onResult={(_result, page) => {
          const next = `?url=${encodeURIComponent(page.requestedUrl)}`;
          if (window.location.search !== next) window.history.replaceState(null, '', next);
        }}
      />
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
