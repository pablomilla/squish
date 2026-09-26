/**
 * Where somebody is and what they read, as headers on every call to the
 * server: the AI writes in their words and units, and the emails Squish
 * sends them come in their language, with times in their own time zone.
 */
import { currentEnergyUnit, currentRegion } from './region';
import { currentLanguage } from './language';

/** The browser's own time zone ("America/Chicago"), or nothing where it cannot say. */
function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function placeHeaders(): Record<string, string> {
  const zone = timeZone();
  return {
    'X-Squish-Region': currentRegion().id,
    'X-Squish-Energy': currentEnergyUnit(),
    'X-Squish-Language': currentLanguage().id,
    ...(zone ? { 'X-Squish-Zone': zone } : {}),
  };
}
