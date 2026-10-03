/**
 * Keeping the home-screen widgets up to date (src/lib/widgetData.ts has what
 * they show). Only in the phone app: the web has no widgets.
 *
 * The summary is handed to a small plugin in each native project
 * (SceneDelegate.swift's WidgetBridge, WidgetBridgePlugin.java), which keeps
 * it where the widget can read it and asks for the widget to be redrawn.
 * Phones ration widget redraws, so it is sent only when it has changed.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from './origin';
import type { WidgetSummary } from './widgetData';

const WidgetBridge = registerPlugin<{ update: (options: { summary: string }) => Promise<void> }>('WidgetBridge');

const HIDE_KEY = 'squish-widget-hidden';

/** Whether this phone's widget keeps today's numbers to itself. This phone only: widgets are per phone. */
export function widgetNumbersHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWidgetNumbersHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, '1');
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    /* no storage: the setting lasts until the app closes */
  }
  window.dispatchEvent(new Event(HIDE_KEY));
}

/** Called when the setting changes, so the widget hears at once. */
export function onWidgetSettingChange(listener: () => void): () => void {
  window.addEventListener(HIDE_KEY, listener);
  return () => window.removeEventListener(HIDE_KEY, listener);
}

let lastSent = '';

/** Hand the widget a new summary, if it is new. Never throws: an app without the plugin simply has no widget. */
export async function sendWidgetSummary(summary: WidgetSummary): Promise<void> {
  if (!isNative()) return;
  const text = JSON.stringify(summary);
  if (text === lastSent) return;
  try {
    await WidgetBridge.update({ summary: text });
    lastSent = text;
  } catch {
    /* an older build without the bridge: nothing to update */
  }
}
