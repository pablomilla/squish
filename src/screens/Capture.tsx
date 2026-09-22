import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../types';
import type { AnalysisResult, MealSlot } from '../types';
import Squish from '../components/Squish';
import Wordmark from '../components/Wordmark';
import { Segmented, Sheet, useToast } from '../components/ui';
import { CameraIcon, CloseIcon, FlashIcon, FlipIcon, HelpIcon, ImageIcon, PenIcon } from '../components/icons';
import { DISPLAY, THUMB, analysePhoto, lookupBarcode, reshrink, shrinkImage } from '../lib/api';
import { scanner } from '../lib/barcode';
import { useSquish } from '../store/useSquish';
import { slotForNow } from '../lib/date';
import './capture.css';

interface Props {
  slot?: MealSlot;
  date?: string;
  /** Which mode to open in. A barcode chosen from the add sheet lands ready. */
  shot?: Shot;
  onCancel: () => void;
  onAnalysed: (
    analysis: AnalysisResult,
    options: { photo?: string; photoFull?: string; slot?: MealSlot; date?: string },
  ) => void;
  go: (route: Route) => void;
}

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable' | 'unsupported';
/**
 * Three jobs for one camera. A plate is estimated, a label is read, and a
 * barcode is watched for continuously — there is no shutter to press for that
 * one, it either sees the code or it does not.
 */
type Shot = 'plate' | 'label' | 'barcode';

/**
 * How often to look for a barcode.
 *
 * Slightly slower than it was, on the grounds that it was comfortably fast
 * enough. It used to slow down further after a few seconds, which was clever
 * and is gone: a scanner that stopped working turned up on a real phone right
 * after it went in, and the saving never justified being the only thing that
 * had changed. A decode costs about 30 ms — measured — against a camera that
 * is on the whole time, so there was very little there to win.
 */
const LOOK_MS = 400;

/** How long to watch before admitting, on screen, that it is not going well. */
const STRUGGLING_MS = 10_000;
type Facing = 'environment' | 'user';

/** navigator.mediaDevices is genuinely absent on insecure origins, whatever the types say. */
const cameraSupported = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * The torch is a device capability rather than a web standard, so it is absent
 * from the DOM types — and absent from iOS Safari entirely. Both accesses are
 * cast deliberately and guarded at runtime.
 */
const hasTorch = (track?: MediaStreamTrack): boolean => {
  const capabilities = (track as unknown as { getCapabilities?: () => { torch?: boolean } } | undefined)
    ?.getCapabilities?.();
  return Boolean(capabilities?.torch);
};

const applyTorch = (track: MediaStreamTrack, on: boolean): Promise<void> =>
  track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);

const CAMERA_MESSAGE: Record<Exclude<CameraState, 'ready'>, string> = {
  requesting: 'Just checking I can use the camera…',
  denied:
    'The camera is blocked for this site. Allow it in your browser settings, or pick a photo from your library instead.',
  unavailable: 'I could not open the camera. Pick a photo from your library, or describe the meal and I will work it out.',
  unsupported: 'This browser will not give me a camera. Pick a photo from your library, or describe the meal instead.',
};

const THINKING_LINES: Record<Shot, string[]> = {
  plate: ['Looking at your plate…', 'Spotting the ingredients…', 'Sizing up the portions…', 'Adding up the good stuff…'],
  label: ['Finding the label…', 'Reading the numbers…', 'Checking the serving size…', 'Adding it up…'],
  barcode: ['Looking it up…', 'Checking the database…'],
};

const GUIDE: Record<Shot, string> = {
  plate: 'Whole plate in the frame — the rim is what Squish measures against.',
  label: 'Fill the frame with the nutrition table.',
  barcode: 'Hold the barcode steady in the frame.',
};

const LABEL_TIPS = [
  ['🔍', 'Fill the frame with the nutrition table itself — not the whole packet.'],
  ['📐', 'Straight on, not at an angle. A curved tin or bag bends the rows out of line.'],
  ['💡', 'Watch for glare on shiny packaging. Tilt it away from the light rather than using the flash.'],
  ['🥄', 'Squish reads the per-serving column when there is one, so check the serving it picked.'],
];

const TIPS = [
  ['🔆', 'Good light beats a good camera. Near a window is ideal; overhead kitchen light is fine.'],
  ['🍽️', 'Get the whole plate in frame. Anything cropped out is nutrition I cannot count.'],
  ['📐', 'Shoot from slightly above, at an angle — straight down hides how deep a bowl is.'],
  ['🥄', 'Leave a fork or hand in shot. It tells me the scale, and portions are half the answer.'],
  ['🫙', 'Dressings, oil and sauces are invisible. Mention them after, and I will add them in.'],
];

export default function Capture({ slot, date, shot: initialShot = 'plate', onCancel, onAnalysed, go }: Props) {
  const toast = useToast();
  const countPhotoAnalysis = useSquish((s) => s.countPhotoAnalysis);
  const profile = useSquish((s) => s.profile);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mealSlot, setMealSlot] = useState<MealSlot>(slot ?? slotForNow());
  const [preview, setPreview] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>(() => (cameraSupported() ? 'requesting' : 'unsupported'));
  const [facing, setFacing] = useState<Facing>('environment');
  const [canFlip, setCanFlip] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const [tips, setTips] = useState(false);
  const [shot, setShot] = useState<Shot>(initialShot);
  const [scanning, setScanning] = useState(false);
  const [struggling, setStruggling] = useState(false);
  const cameraReady = camera === 'ready';

  const track = stream?.getVideoTracks()[0];
  const torchSupported = hasTorch(track);

  useEffect(() => {
    let cancelled = false;
    if (!cameraSupported()) return;

    // Stop whatever is running before asking for the other lens, or the old
    // track keeps the camera busy and the new request fails on some phones.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setTorchOn(false);

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then(async (media) => {
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = media;
        setStream(media);
        setCamera('ready');

        // Device labels and counts only arrive once permission is granted.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : '';
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  /**
   * Attach the stream once the element exists. This cannot be done where the
   * stream arrives: the ref is still null at that point, which is what made
   * the preview a black screen with a live camera behind it.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {
      /* a rejected play leaves the poster frame; the shutter still works */
    });
  }, [stream]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setLine((n) => (n + 1) % THINKING_LINES[shot].length), 2200);
    return () => clearInterval(timer);
  }, [busy, shot]);

  const toggleTorch = useCallback(async () => {
    if (!track) return;
    const next = !torchOn;
    try {
      await applyTorch(track, next);
      setTorchOn(next);
    } catch {
      toast('This camera will not turn its light on.', '💡');
    }
  }, [track, torchOn, toast]);

  const run = useCallback(
    async (dataUrl: string) => {
      setPreview(dataUrl);
      setBusy(true);
      try {
        // Barcode mode never reaches here — it has no shutter to press.
        const analysis = await analysePhoto(dataUrl, mealSlot, undefined, shot === 'label' ? 'label' : 'plate', {
          plateCm: profile.plateCm,
          bowlMl: profile.bowlMl,
        });
        countPhotoAnalysis();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        // Two smaller copies: one to look at, one to keep in the diary. The
        // analysis-size image is not stored anywhere — it has done its job.
        const [full, thumb] = await Promise.all([
          reshrink(dataUrl, DISPLAY.maxSide, DISPLAY.quality),
          reshrink(dataUrl, THUMB.maxSide, THUMB.quality),
        ]);
        onAnalysed(analysis, { photo: thumb, photoFull: full, slot: analysis.slot ?? mealSlot, date });
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'I could not read that photo — try again or describe it instead.',
          '😅',
        );
        setBusy(false);
        setPreview(null);
      }
    },
    [mealSlot, date, shot, onAnalysed, countPhotoAnalysis, toast, profile.plateCm, profile.bowlMl],
  );

  const lookUp = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const analysis = await lookupBarcode(code, mealSlot);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onAnalysed(analysis, { slot: analysis.slot ?? mealSlot, date });
      } catch (error) {
        toast(error instanceof Error ? error.message : 'That lookup did not work.', '😕');
        setBusy(false);
      }
    },
    [mealSlot, date, onAnalysed, toast],
  );

  /**
   * Watch the video for a barcode while this mode is open.
   *
   * Frames are grabbed onto a canvas and handed to the detector a few times a
   * second — often enough to feel instant, rarely enough that a phone does not
   * get hot. `navigator.vibrate` is absent on iOS, hence the optional call.
   *
   * It slows down after a few seconds, and the reason is worth writing down
   * because it is not the obvious one. A decode costs about 30 ms on a full
   * 1920x1080 frame — measured, not guessed — so even at three a second this
   * is a tenth of a core, and nowhere near the cost of keeping the camera on,
   * which is what actually empties the battery on this screen. Nearly every
   * scan that works lands in the first second or two. The ones that burn power
   * are the ones where somebody is fighting glare or focus, and there a third
   * attempt each second buys nothing at all. So: brisk while it is likely to
   * land, and easier on the phone once it plainly is not.
   */
  useEffect(() => {
    if (shot !== 'barcode' || !cameraReady || busy) return;

    let live = true;
    let timer: number | undefined;
    const canvas = document.createElement('canvas');
    // Said out loud rather than left to be guessed at. A scanner that quietly
    // watches nothing looks exactly like a scanner that is about to work, and
    // the difference is the whole of a bug report.
    const patience = window.setTimeout(() => setStruggling(true), STRUGGLING_MS);

    (async () => {
      let detector: Awaited<ReturnType<typeof scanner>>;
      try {
        detector = await scanner();
      } catch {
        if (live) toast('This browser will not scan barcodes. Try the label instead.', '😕');
        return;
      }
      if (!live) return;
      setScanning(true);

      const look = async () => {
        if (!live) return;
        const video = videoRef.current;

        /*
         * A frame may not exist yet, and that is not a reason to give up.
         *
         * `cameraReady` is set the moment getUserMedia resolves, which is
         * before the stream is attached to the element and well before
         * `loadedmetadata` gives it a size. Whether the first look landed
         * before or after that was a race against how long the decoder took
         * to download — and losing it used to end the scan permanently, with
         * the screen still saying it was scanning. Wait and look again.
         */
        if (!video?.videoWidth) {
          timer = window.setTimeout(() => void look(), 120);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        // Read back three times a second for as long as the scanner is open;
        // without this the browser keeps the surface somewhere that makes
        // every getImageData a copy off the GPU.
        canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0);
        try {
          const [found] = await detector.detect(canvas);
          if (found && live) {
            live = false;
            navigator.vibrate?.(60);
            toast(`Found ${found.value}`, '🏷️');
            void lookUp(found.value);
            return;
          }
        } catch {
          /* a frame that will not decode is the normal case, not an error */
        }
        if (live) timer = window.setTimeout(() => void look(), LOOK_MS);
      };
      void look();
    })();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      clearTimeout(patience);
      setScanning(false);
      setStruggling(false);
    };
  }, [shot, cameraReady, busy, lookUp, toast]);

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    void run(canvas.toDataURL('image/jpeg', 0.82));
  }, [run]);

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        void run(await shrinkImage(file));
      } catch {
        toast('That file would not open.', '😕');
      }
    },
    [run, toast],
  );

  if (busy) {
    return (
      <div className="screen capture-analysing">
        {preview && <img src={preview} alt="" className="capture-analysing-photo" />}
        <Squish mood="thinking" size={150} />
        <h2>{THINKING_LINES[shot][line]}</h2>
        <p className="muted small center">
          {shot === 'label'
            ? 'Squish is reading the figures straight off the packet.'
            : 'Squish is working out the calories, macros and fibre for you.'}
        </p>
        <div className="capture-skeletons">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 14, width: `${80 - i * 14}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="capture">
      <div className="capture-stage">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`capture-video ${cameraReady ? '' : 'is-hidden'} ${facing === 'user' ? 'is-mirrored' : ''}`}
        />
        {!cameraReady && (
          <div className="capture-fallback">
            <Squish mood={camera === 'requesting' ? 'thinking' : 'calm'} size={128} />
            <p className="small muted center" style={{ maxWidth: 260 }}>
              {CAMERA_MESSAGE[camera]}
            </p>
          </div>
        )}

        <div className="capture-top">
          <button type="button" className="capture-round" onClick={onCancel} aria-label="Close">
            <CloseIcon />
          </button>
          <Wordmark width={84} className="capture-wordmark" />
          <button type="button" className="capture-round" onClick={() => setTips(true)} aria-label="Photo tips">
            <HelpIcon />
          </button>
        </div>

        <div className="capture-frame" aria-hidden="true">
          <span /><span /><span /><span />
        </div>

        <p className="capture-guide">{GUIDE[shot]}</p>

        <div className="capture-shot">
          <Segmented<Shot>
            label="What are you photographing?"
            value={shot}
            onChange={setShot}
            options={[
              { value: 'plate', label: 'Food' },
              { value: 'label', label: 'Label' },
              { value: 'barcode', label: 'Barcode' },
            ]}
          />
        </div>

        <div className="capture-slot">
          <Segmented<MealSlot>
            label="Meal"
            value={mealSlot}
            onChange={setMealSlot}
            options={[
              { value: 'breakfast', label: 'Breakfast' },
              { value: 'lunch', label: 'Lunch' },
              { value: 'dinner', label: 'Dinner' },
              { value: 'snack', label: 'Snack' },
            ]}
          />
        </div>
      </div>

      <div className="capture-controls">
        <button type="button" className="capture-side" onClick={() => fileRef.current?.click()}>
          <ImageIcon size={24} />
          <span className="tiny">Library</span>
        </button>

        {shot === 'barcode' ? (
          <div className="capture-watching" aria-live="polite">
            <span className="capture-watching-dot" aria-hidden="true" />
            <span className="tiny">
              {!scanning ? 'Getting the scanner ready…' : struggling ? 'Still looking — more light, or try Label' : 'Watching for a barcode…'}
            </span>
          </div>
        ) : (
          <button type="button" className="capture-shutter" onClick={shoot} disabled={!cameraReady} aria-label="Take photo">
            <span />
          </button>
        )}

        {/* Whichever of these the device can actually do. Neither is guaranteed:
            iOS has no torch over the web, and a laptop has one camera. */}
        {torchSupported ? (
          <button type="button" className={`capture-side ${torchOn ? 'is-on' : ''}`} onClick={() => void toggleTorch()} aria-pressed={torchOn}>
            <FlashIcon size={24} />
            <span className="tiny">Flash</span>
          </button>
        ) : canFlip ? (
          <button
            type="button"
            className="capture-side"
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
          >
            <FlipIcon size={24} />
            <span className="tiny">Flip</span>
          </button>
        ) : (
          <span className="capture-side capture-side--empty" aria-hidden="true" />
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // No `capture` attribute: it sends the browser straight to the camera
          // and skips the photo picker, which is the one thing this button is for.
          className="visually-hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      <button
        type="button"
        className="capture-describe"
        onClick={() => go({ name: 'add', tab: 'describe', slot: mealSlot, date })}
      >
        <PenIcon size={16} /> Describe it instead
      </button>

      <Sheet open={tips} onClose={() => setTips(false)} title={shot === 'label' ? 'A good label photo' : 'A good food photo'}>
        <div className="stack">
          {(shot === 'label' ? LABEL_TIPS : TIPS).map(([emoji, text]) => (
            <div className="row" key={text} style={{ alignItems: 'flex-start', gap: 12 }}>
              <span aria-hidden="true" style={{ fontSize: 22 }}>{emoji}</span>
              <p className="small">{text}</p>
            </div>
          ))}
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <CameraIcon size={22} />
            <p className="small">
              Nothing is stored. The photo goes to Squish for a few seconds to be read, and is kept only on this device
              with the meal.
            </p>
          </div>
          <button type="button" className="btn btn--block" onClick={() => setTips(false)}>
            Got it
          </button>
        </div>
      </Sheet>
    </div>
  );
}
