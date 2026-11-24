import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two builds from one config:
//   npm run build:app  ->  dist/      the standalone app Netlify deploys
//   npm run build:lib  ->  dist/lib/  the <UrlExtractor> component for other React projects
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [react()],
      publicDir: false,
      build: {
        outDir: 'dist/lib',
        emptyOutDir: true,
        cssCodeSplit: false,
        sourcemap: true,
        lib: {
          entry: 'src/index.ts',
          formats: ['es'],
          fileName: () => 'url-extractor.js',
          cssFileName: 'url-extractor',
        },
        rolldownOptions: {
          // React stays a peer dependency; tldts is a regular dependency the host installs.
          external: [/^react(\/.*)?$/, /^react-dom(\/.*)?$/, 'tldts'],
        },
      },
    };
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
