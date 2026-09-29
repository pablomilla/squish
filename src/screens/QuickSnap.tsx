import { useCallback, useEffect, useRef, useState } from 'react';
import Squish from '../components/Squish';
import { CloseIcon, ImageIcon } from '../components/icons';
import { shrinkImage } from '../lib/api';
import { takeSnap } from '../lib/snaps';
import { finishQuickSnap } from '../lib/launch';
import { plural, t } from '../lib/i18n';
import './capture.css';
import './quick-snap.css';

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable' | 'unsupported';

const cameraSupported = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

/** The camera's first frame, or three seconds, whichever comes first. */
const firstFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      resolve();
    };
    const timer = setTimeout(done, 3000);
    video.addEventListener('loadeddata', done);
  });

/**
 * Straight into the camera, from a widget or a shortcut, for when there is
 * no time or it would be rude to stand there with a phone: one tap takes it,
 * and that is all. Nothing to choose (the meal is whichever it is by the
 * clock), nothing to read, nothing to wait for — the photo is kept at once
 * and read in the background (src/lib/snaps.ts), and the meal turns up in the
 * diary marked to check when there is a moment.
 */
export default function QuickSnap({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<CameraState>(() => (cameraSupported() ? 'requesting' : 'unsupported'));
  const [taken, setTaken] = useState(0);
  const [flash, setFlash] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cameraSupported()) return;
    let cancelled = false;
    let media: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((found) => {
        if (cancelled) {
          found.getTracks().forEach((track) => track.stop());
          return;
        }
        media = found;
        setStream(found);
        setCamera('ready');
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : '';
        setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });
    return () => {
      cancelled = true;
      media?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Attached once the element exists (see Capture for the black screen this avoids).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);

  const keep = useCallback(async (dataUrl: string) => {
    setSaving(true);
    setFailed(false);
    try {
      await takeSnap(dataUrl);
      setTaken((n) => n + 1);
      setFlash((n) => n + 1);
      // A tap you can feel, where the phone does that: no need to look to know it worked.
      navigator.vibrate?.(12);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, []);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || saving) return;
    // Tapped the moment the camera appeared, before its first frame: that tap still counts.
    if (!video.videoWidth) await firstFrame(video);
    if (!video.videoWidth) {
      setFailed(true);
      return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    void keep(canvas.toDataURL('image/jpeg', 0.82));
  }, [keep, saving]);

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        await keep(await shrinkImage(file));
      } catch {
        setFailed(true);
      }
    },
    [keep],
  );

  const done = () => {
    stream?.getTracks().forEach((track) => track.stop());
    finishQuickSnap(onClose);
  };

  const ready = camera === 'ready';

  return (
    <div className="capture quick-snap">
      <div className="capture-stage">
        <video ref={videoRef} autoPlay playsInline muted className={`capture-video ${ready ? '' : 'is-hidden'}`} />
        {!ready && (
          <div className="capture-fallback">
            <Squish mood={camera === 'requesting' ? 'thinking' : 'calm'} size={112} />
            {camera !== 'requesting' && (
              <>
                <p className="small muted center" style={{ maxWidth: 260 }}>
                  {camera === 'denied'
                    ? t('The camera is blocked for Squish. Take the photo with your phone’s camera instead — it is logged just the same.')
                    : t('No camera here. Take the photo with your phone’s camera instead — it is logged just the same.')}
                </p>
                <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                  {t('Take a photo')}
                </button>
              </>
            )}
          </div>
        )}
        {flash > 0 && <div key={flash} className="quick-snap-flash" aria-hidden="true" />}

        <div className="capture-top">
          <button type="button" className="capture-round" onClick={done} aria-label={t('Close')}>
            <CloseIcon />
          </button>
          <span className="quick-snap-title">{t('Quick snap')}</span>
          <span className="capture-round quick-snap-spacer" aria-hidden="true" />
        </div>

        <p className="quick-snap-status" role="status" aria-live="polite">
          {failed
            ? t('That one did not save. Try again.')
            : taken
              ? plural(taken, { one: 'Snapped. Squish will log it — check it later.', other: '{n} snapped. Squish will log them — check them later.' })
              : t('One tap and put your phone away. Squish logs it for you to check later.')}
        </p>
      </div>

      <div className="capture-controls">
        <button type="button" className="capture-side" onClick={() => fileRef.current?.click()}>
          <ImageIcon size={24} />
          <span className="tiny">{t('Library')}</span>
        </button>
        <button type="button" className="capture-shutter" onClick={() => void shoot()} disabled={!ready || saving} aria-label={t('Snap it')}>
          <span />
        </button>
        <button type="button" className={`capture-side quick-snap-done${taken ? ' is-on' : ''}`} onClick={done}>
          <span className="quick-snap-done-mark" aria-hidden="true">✓</span>
          <span className="tiny">{t('Done')}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // Here the camera is the point: where the page cannot have one, the phone's own opens.
          capture="environment"
          className="visually-hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
