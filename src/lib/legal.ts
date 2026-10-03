/**
 * The privacy policy and terms of use, as the server serves them — in the
 * app's language, and in English its country's spelling. Served outside the
 * app (server/privacy.ts), so they open for somebody with nothing installed.
 */
import { apiUrl } from './origin';
import { currentLanguage } from './language';
import { currentRegion } from './region';

/** The website's Help page in the app's language, by way of the server (it knows where the website is). */
export const helpHref = (section?: string): string => apiUrl(`/help?lang=${currentLanguage().id}${section ? `&at=${section}` : ''}`);

export const legalHref = (path: '/privacy' | '/terms', section?: string): string =>
  apiUrl(`${path}?lang=${currentLanguage().id}&country=${currentRegion().id}${section ? `#${section}` : ''}`);
