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
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraReady(true);
      })
      .catch(() => setCameraReady(false));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
        {cameraReady ? (
          <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
        ) : (
          <div className="capture-fallback">
            <Squish mood="calm" size={128} />
            <p className="small muted center" style={{ maxWidth: 260 }}>
              No camera here — pick a photo from your library, or describe the meal and I'll work it out.
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
          capture="environment"
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
