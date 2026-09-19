/**
 * Reading a barcode off the camera.
 *
 * Browsers have a `BarcodeDetector` built in, but only really on Chrome for
 * Android: Safari hides it behind a flag that is off by default, desktop
 * Chrome only ships it on macOS and ChromeOS, and Firefox has never had it. So
 * the native one is used where it genuinely exists and a WebAssembly decoder
 * is loaded everywhere else — which, for an app most people will open on an
 * iPhone, is most of the time.
 *
 * The fallback is about a megabyte, so it is imported only when the scanner is
 * actually opened, and never on the path of someone who only photographs food.
 */

import { looksLikeBarcode } from './gtin';

/** The symbologies on food packaging. Anything else is noise to us. */
export const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'] as const;

export interface Detected {
  value: string;
  format: string;
}

export interface Scanner {
  detect(source: CanvasImageSource): Promise<Detected[]>;
  /** Which implementation answered, for the diagnostics on the You screen. */
  kind: 'native' | 'wasm';
}

type DetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> };

/**
 * Whether the browser's own detector is real and can read a shop barcode.
 * Presence of the constructor is not enough — some builds expose it and then
 * support nothing useful, so the format list is the actual test.
 */
async function nativeScanner(): Promise<DetectorLike | null> {
  const Native = (globalThis as { BarcodeDetector?: new (o?: { formats?: string[] }) => DetectorLike }).BarcodeDetector;
  if (!Native) return null;

  try {
    const supported: string[] = await (
      Native as unknown as { getSupportedFormats(): Promise<string[]> }
    ).getSupportedFormats();
    const usable = FORMATS.filter((f) => supported.includes(f));
    if (!usable.includes('ean_13')) return null;
    return new Native({ formats: usable });
  } catch {
    return null;
  }
}

let pending: Promise<Scanner> | null = null;

/** One scanner per page, since the fallback has a megabyte to fetch. */
export function scanner(): Promise<Scanner> {
  pending ??= build();
  return pending;
}

async function build(): Promise<Scanner> {
  const native = await nativeScanner();
  if (native) {
    return { kind: 'native', detect: (source) => native.detect(source).then(normalise) };
  }

  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    // Served from our own origin rather than a CDN: it keeps working behind a
    // strict content policy, and on a phone with a patchy connection.
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);

  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });

  const detector = new BarcodeDetector({ formats: [...FORMATS] });
  return { kind: 'wasm', detect: (source) => detector.detect(source).then(normalise) };
}

/**
 * Anything that is not a food barcode is dropped here rather than sent to the
 * server — a QR code in the corner of the frame should not cost a lookup.
 */
const normalise = (found: { rawValue: string; format: string }[]): Detected[] =>
  found.map((one) => ({ value: one.rawValue, format: one.format })).filter((one) => looksLikeBarcode(one.value));
