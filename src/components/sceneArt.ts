/**
 * Where each Home scene's pictures are served from. Fingerprinted by Vite, so
 * they cache for ever and a redrawn scene gets a new address.
 */
const urls = import.meta.glob<string>('../assets/scenes/*.svg', { query: '?url', import: 'default', eager: true });

export const sceneUrl = (id: string, mode: 'light' | 'dark'): string | undefined => urls[`../assets/scenes/${id}-${mode}.svg`];
