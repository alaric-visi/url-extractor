// Library entry: the React component, plus the framework-free core for scripts and tests.
export { UrlExtractor, type UrlExtractorProps } from './components/UrlExtractor';
export { useExtractor, type ExtractorError, type ExtractorStatus } from './hooks/useExtractor';
export {
  fetchPage,
  FetchPageError,
  DEFAULT_ENDPOINT,
  type FetchedPage,
  type FetchErrorCode,
  type FetchPageOptions,
  type PageInfo,
} from './services/fetch-page';
export * from './core';
