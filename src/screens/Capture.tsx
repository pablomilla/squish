import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../App';
import type { AnalysisResult, MealSlot } from '../types';
import Squish from '../components/Squish';
import { Segmented, useToast } from '../components/ui';
import { CameraIcon, CloseIcon, ImageIcon, PenIcon } from '../components/icons';
import { analysePhoto, shrinkImage, SquishApiError } from '../lib/api';
import { useSquish } from '../store/useSquish';
import { slotForNow } from '../lib/date';
import './capture.css';

interface Props {
  slot?: MealSlot;
  date?: string;
  onCancel: () => void;
  onAnalysed: (analysis: AnalysisResult, options: { photo?: string; slot?: MealSlot; date?: string }) => void;
  go: (route: Route) => void;
}

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable' | 'unsupported';

/** navigator.mediaDevices is genuinely absent on insecure origins, whatever the types say. */
const cameraSupported = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

const CAMERA_MESSAGE: Record<Exclude<CameraState, 'ready'>, string> = {
  requesting: 'Just checking I can use the camera…',
  denied:
    'The camera is blocked for this site. Allow it in your browser settings, or pick a photo from your library instead.',
  unavailable: 'I could not open the camera. Pick a photo from your library, or describe the meal and I will work it out.',
  unsupported: 'This browser will not give me a camera. Pick a photo from your library, or describe the meal instead.',
};

const THINKING_LINES = [
  'Looking at your plate…',
  'Spotting the ingredients…',
  'Sizing up the portions…',
  'Adding up the good stuff…',
];

export default function Capture({ slot, date, onCancel, onAnalysed, go }: Props) {
  const toast = useToast();
  const countPhotoAnalysis = useSquish((s) => s.countPhotoAnalysis);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mealSlot, setMealSlot] = useState<MealSlot>(slot ?? slotForNow());
  const [preview, setPreview] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Support is knowable at first render — no need to spend a render to find out.
  const [camera, setCamera] = useState<CameraState>(() =>
    cameraSupported() ? 'requesting' : 'unsupported',
  );
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const cameraReady = camera === 'ready';

  useEffect(() => {
    let cancelled = false;

    if (!cameraSupported()) return;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = media;
        setStream(media);
        setCamera('ready');
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : '';
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  /**
   * Attach the stream once the element exists.
   *
   * This cannot be done where the stream arrives: the video element is only in
   * the DOM once the camera reports ready, so the ref is still null at that
   * point and the picture never appears — a black screen with a live camera
   * behind it. Safari also will not always autoplay a stream attached after
   * mount, hence the explicit play().
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
    const timer = setInterval(() => setLine((n) => (n + 1) % THINKING_LINES.length), 2200);
    return () => clearInterval(timer);
  }, [busy]);

  const run = useCallback(
    async (dataUrl: string) => {
      setPreview(dataUrl);
      setBusy(true);
      try {
        const analysis = await analysePhoto(dataUrl, mealSlot);
        countPhotoAnalysis();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        onAnalysed(analysis, { photo: dataUrl, slot: analysis.slot ?? mealSlot, date });
      } catch (error) {
        toast(
          error instanceof SquishApiError ? error.message : 'I could not read that photo — try again or describe it instead.',
          '😅',
        );
        setBusy(false);
        setPreview(null);
      }
    },
    [mealSlot, date, onAnalysed, countPhotoAnalysis, toast],
  );

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
        <h2>{THINKING_LINES[line]}</h2>
        <p className="muted small center">Squish is working out the calories, macros and fibre for you.</p>
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
          className={`capture-video ${cameraReady ? '' : 'is-hidden'}`}
        />
        {!cameraReady && (
          <div className="capture-fallback">
            <Squish mood={camera === 'requesting' ? 'thinking' : 'calm'} size={128} />
            <p className="small muted center" style={{ maxWidth: 260 }}>
              {CAMERA_MESSAGE[camera]}
            </p>
          </div>
        )}
        <div className="capture-frame" aria-hidden="true">
          <span /><span /><span /><span />
        </div>

        <button type="button" className="capture-close" onClick={onCancel} aria-label="Close">
          <CloseIcon />
        </button>

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
        <button type="button" className="capture-side" onClick={() => fileRef.current?.click()} aria-label="Choose a photo">
          <ImageIcon size={24} />
          <span className="tiny">Library</span>
        </button>

        <button type="button" className="capture-shutter" onClick={shoot} disabled={!cameraReady} aria-label="Take photo">
          <span />
        </button>

        <button type="button" className="capture-side" onClick={() => go({ name: 'add', tab: 'describe', slot: mealSlot, date })} aria-label="Describe the meal">
          <PenIcon size={24} />
          <span className="tiny">Describe</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // No `capture` attribute: it sends the browser straight to the camera
          // and skips the photo picker, which is the one thing this button is
          // for. Squish has its own camera a few pixels to the left.
          className="visually-hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      <p className="capture-hint">
        <CameraIcon size={15} /> Get the whole plate in frame for the best estimate.
      </p>
    </div>
  );
}
