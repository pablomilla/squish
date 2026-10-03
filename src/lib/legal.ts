/**
 * The privacy policy and terms of use, as the server serves them — in the
 * app's language, and in English its country's spelling. Served outside the
 * app (server/privacy.ts), so they open for somebody with nothing installed.
 */
import { apiUrl } from './origin';
import { currentLanguage } from './language';
import { currentRegion } from './region';

export const legalHref = (path: '/privacy' | '/terms', section?: string): string =>
  apiUrl(`${path}?lang=${currentLanguage().id}&country=${currentRegion().id}${section ? `#${section}` : ''}`);
