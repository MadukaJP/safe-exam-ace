import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Eye, Mic, Monitor, Maximize, Shield, Clock } from 'lucide-react';
import {
  type Violation, type CaptureLog, type AudioClip, type ViolationType,
  VIOLATION_CONFIG, VIOLATION_TOAST, uid, formatTime,
} from '@/lib/quiz-types';
import {
  detectFaces, extractEmbeddingFromLandmarks, cosineSimilarity,
  snapStream, getHeadYaw, getHeadPitch, detectMultipleMonitors,
} from '@/lib/proctoring';

export interface ProctorData {
  violations: Violation[];
  captureLogs: CaptureLog[];
  audioClips: AudioClip[];
  faceStatus: 'ok' | 'none' | 'multiple' | 'mismatch';
  screenOk: boolean;
  audioLevel: number;
  timeLeft: number;
}

interface ProctorWrapperProps {
  webcamStream: MediaStream;
  micStream: MediaStream;
  screenStream: MediaStream;
  referenceEmbedding: number[] | null;
  durationSeconds: number;
  proctorEnabled?: boolean;
  examTitle?: string;
  onTimeUp: (data: { violations: Violation[]; captureLogs: CaptureLog[]; audioClips: AudioClip[]; timeSpent: number }) => void;
  onManualSubmit: (data: { violations: Violation[]; captureLogs: CaptureLog[]; audioClips: AudioClip[]; timeSpent: number }) => void;
  children: (data: ProctorData & { requestSubmit: () => void }) => ReactNode;
}

export default function ProctorWrapper({
  webcamStream, micStream, screenStream, referenceEmbedding,
  durationSeconds, proctorEnabled = true, examTitle = 'Proctored Exam',
  onTimeUp, onManualSubmit, children,
}: ProctorWrapperProps) {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [captureLogs, setCaptureLogs] = useState<CaptureLog[]>([]);
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [faceStatus, setFaceStatus] = useState<'ok' | 'none' | 'multiple' | 'mismatch'>('ok');
  const [screenOk, setScreenOk] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [multiMonitorBlocked, setMultiMonitorBlocked] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [screenShareCountdown, setScreenShareCountdown] = useState<number | null>(null);

  const webcamRef = useRef(webcamStream);
  const micRef = useRef(micStream);
  const screenRef = useRef(screenStream);
  const embeddingRef = useRef(referenceEmbedding);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef<Record<string, number>>({});
  const tabHiddenAtRef = useRef<number | null>(null);
  const audioClipsRef = useRef<AudioClip[]>([]);
  const violationsRef = useRef<Violation[]>([]);
  const captureLogsRef = useRef<CaptureLog[]>([]);
  const submittedRef = useRef(false);
  const screenStopCountRef = useRef(0);
  const screenCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gazeAwayStartRef = useRef<number | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => { violationsRef.current = violations; }, [violations]);
  useEffect(() => { captureLogsRef.current = captureLogs; }, [captureLogs]);

  const logCapture = useCallback((kind: 'webcam' | 'screen', dataUrl: string, trigger: CaptureLog['trigger']) => {
    const entry: CaptureLog = { id: uid(), timestamp: new Date(), kind, dataUrl, trigger };
    setCaptureLogs(prev => [...prev, entry]);
  }, []);

  const addViolation = useCallback(async (
    type: ViolationType,
    opts: { captureScreen?: boolean; awayMs?: number; detail?: string; skipCooldown?: boolean; audioUrl?: string } = {}
  ) => {
    const now = Date.now();
    if (!opts.skipCooldown && type !== 'TAB_SWITCH' && (cooldownRef.current[type] ?? 0) + 10_000 > now) return;
    if (!opts.skipCooldown) cooldownRef.current[type] = now;

    const cfg = VIOLATION_CONFIG[type];
    const msg = VIOLATION_TOAST[type] ?? cfg.label;
    const awayStr = opts.awayMs ? ` (${(opts.awayMs / 1000).toFixed(1)}s)` : '';
    (cfg.severity === 'error' ? toast.error : toast.warning)(msg + awayStr, { duration: 4000 });

    const [webcamShot, screenShot] = await Promise.all([
      snapStream(webcamRef.current),
      opts.captureScreen ? snapStream(screenRef.current) : Promise.resolve(undefined),
    ]);

    const v: Violation = {
      id: uid(), type, label: cfg.label, severity: cfg.severity,
      timestamp: new Date(), webcamShot, screenShot, audioUrl: opts.audioUrl,
      awayMs: opts.awayMs, detail: opts.detail,
    };
    setViolations(prev => [...prev, v]);
    if (webcamShot) logCapture('webcam', webcamShot, 'violation');
    if (screenShot) logCapture('screen', screenShot, 'violation');
    return v.id;
  }, [logCapture]);

  // ══════════════════════════════════════════════════════════════════
  // KEYBOARD BLOCKING (always active)
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    const BLOCKED = new Set(['F12', 'F11', 'F5']);
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const key = e.key;
      const isBlocked =
        BLOCKED.has(key) ||
        (ctrl && shift && ['I', 'J', 'C'].includes(key.toUpperCase())) ||
        (ctrl && ['U', 'S', 'P'].includes(key.toUpperCase())) ||
        (e.altKey && key === 'Tab') ||
        (e.metaKey && key === 'Tab') ||
        (e.metaKey && key === 'h') ||
        (e.metaKey && key === 'm');
      if (isBlocked) {
        e.preventDefault();
        e.stopPropagation();
        if (proctorEnabled) {
          addViolation('KEYBOARD_SHORTCUT', { detail: `${ctrl ? 'Ctrl+' : ''}${shift ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${key}` });
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [addViolation, proctorEnabled]);

  // ══════════════════════════════════════════════════════════════════
  // TAB, CLIPBOARD, FULLSCREEN, MULTI-MONITOR, DEVTOOLS, SCREEN SHARE
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!proctorEnabled) return;

    // Tab switch — capture screenshot IMMEDIATELY when leaving
    const onVisibility = async () => {
      if (document.hidden) {
        tabHiddenAtRef.current = Date.now();
        // Capture screen NOW while leaving
        await addViolation('TAB_SWITCH', { captureScreen: true });
      } else {
        const awayMs = tabHiddenAtRef.current ? Date.now() - tabHiddenAtRef.current : undefined;
        tabHiddenAtRef.current = null;
        if (awayMs) {
          // Update the last TAB_SWITCH violation with away duration
          setViolations(prev => {
            const copy = [...prev];
            const last = [...copy].reverse().find(v => v.type === 'TAB_SWITCH');
            if (last) last.awayMs = awayMs;
            return copy;
          });
        }
      }
    };
    const onBlur = () => addViolation('WINDOW_BLUR');
    const onClip = (e: ClipboardEvent) => { e.preventDefault(); addViolation('COPY_ATTEMPT'); };
    const onCtx = (e: MouseEvent) => { e.preventDefault(); addViolation('CONTEXT_MENU'); };
    const onFs = async () => {
      if (!document.fullscreenElement) {
        setFullscreenBlocked(true);
        const shot = await snapStream(screenRef.current);
        if (shot) logCapture('screen', shot, 'fullscreen_exit');
        addViolation('FULLSCREEN_EXIT', { captureScreen: true });
      } else {
        setFullscreenBlocked(false);
      }
    };

    // Multiple monitor detection
    const checkMonitors = () => {
      const { detected, reason } = detectMultipleMonitors();
      if (detected) {
        setMultiMonitorBlocked(true);
        addViolation('MULTIPLE_MONITORS', { detail: reason });
      } else {
        setMultiMonitorBlocked(false);
      }
    };
    checkMonitors();
    const monitorInterval = setInterval(checkMonitors, 3000);

    const devtools = setInterval(() => {
      if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160)
        addViolation('DEVTOOLS_OPEN');
    }, 3000);

    // Screen share stop → countdown logic
    const track = screenRef.current?.getVideoTracks()[0];
    const onScreenEnded = () => {
      setScreenOk(false);
      screenStopCountRef.current += 1;
      const stopCount = screenStopCountRef.current;

      if (stopCount >= 2) {
        // Second time → end quiz immediately
        addViolation('SCREEN_SHARE_STOPPED', { detail: 'Screen sharing stopped a second time — exam ended.' });
        doFinish(onManualSubmit);
        return;
      }

      // First time → 5 second countdown
      addViolation('SCREEN_SHARE_STOPPED');
      let remaining = 5;
      setScreenShareCountdown(remaining);
      screenCountdownRef.current = setInterval(() => {
        remaining--;
        setScreenShareCountdown(remaining);
        if (remaining <= 0) {
          if (screenCountdownRef.current) clearInterval(screenCountdownRef.current);
          screenCountdownRef.current = null;
          setScreenShareCountdown(null);
          // If screen wasn't reshared, end quiz
          if (!screenRef.current?.getVideoTracks()[0]?.readyState || screenRef.current.getVideoTracks()[0].readyState !== 'live') {
            doFinish(onManualSubmit);
          }
        }
      }, 1000);
    };
    track?.addEventListener('ended', onScreenEnded);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onClip as EventListener);
    document.addEventListener('cut', onClip as EventListener);
    document.addEventListener('paste', onClip as EventListener);
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('fullscreenchange', onFs);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onClip as EventListener);
      document.removeEventListener('cut', onClip as EventListener);
      document.removeEventListener('paste', onClip as EventListener);
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('fullscreenchange', onFs);
      track?.removeEventListener('ended', onScreenEnded);
      clearInterval(devtools);
      clearInterval(monitorInterval);
      if (screenCountdownRef.current) clearInterval(screenCountdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addViolation, logCapture, proctorEnabled]);

  // Reshare screen handler
  const handleReshareScreen = useCallback(async () => {
    try {
      const newScreen = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
        audio: false,
      });
      const surface = (newScreen.getVideoTracks()[0].getSettings() as any).displaySurface;
      if (surface && surface !== 'monitor') {
        newScreen.getTracks().forEach(t => t.stop());
        toast.error('You must share your entire screen.');
        return;
      }
      screenRef.current = newScreen;
      setScreenOk(true);
      setScreenShareCountdown(null);
      if (screenCountdownRef.current) {
        clearInterval(screenCountdownRef.current);
        screenCountdownRef.current = null;
      }
      // Listen for next stop
      newScreen.getVideoTracks()[0].addEventListener('ended', () => {
        setScreenOk(false);
        screenStopCountRef.current += 1;
        addViolation('SCREEN_SHARE_STOPPED', { detail: 'Screen sharing stopped again — exam ended.' });
        doFinish(onManualSubmit);
      });
      toast.success('Screen sharing resumed.');
    } catch {
      toast.error('Screen share was not started.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addViolation]);

  // ══════════════════════════════════════════════════════════════════
  // AUDIO MONITORING — calibration-based from reference
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!proctorEnabled) return;

    const CALIBRATION_FRAMES = 120;
    const NOISE_MARGIN = 12;
    const NOISE_COOLDOWN_MS = 12_000;
    const RECORD_DURATION_MS = 12_000;

    let animFrame: number;
    let voiceFrames = 0;
    const calSamples: number[] = [];
    let baseline = 28;
    let calibrated = false;
    let saving = false;
    let lastNoiseFlagMs = -Infinity;

    // SpeechRecognition for voice classification
    let isSpeechActive = false;
    let speechEndedAt: number | null = null;
    const SpeechRec =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
    const speechSupported = !!SpeechRec;
    let recognition: any = null;

    if (speechSupported && SpeechRec) {
      try {
        recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.onspeechstart = () => { isSpeechActive = true; speechEndedAt = null; };
        recognition.onspeechend = () => { isSpeechActive = false; speechEndedAt = performance.now(); };
        recognition.onend = () => { try { recognition?.start(); } catch { /**/ } };
        recognition.onerror = () => { /* restart handled by onend */ };
        recognition.start();
      } catch { /* fallback to volume-only */ }
    }

    const recordAndAttach = (noiseViolationId: string, triggerMs: number, avgLevel: number) => {
      if (!micRef.current) return;
      saving = true;
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(micRef.current, mimeType ? { mimeType } : undefined);
      } catch { saving = false; return; }

      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        saving = false;
        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        if (blob.size < 200) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const clip = { timestamp: new Date(), dataUrl };
          audioClipsRef.current = [...audioClipsRef.current, clip];
          setAudioClips(prev => [...prev, clip]);
          // Attach to noise violation
          setViolations(prev => prev.map(v =>
            v.id === noiseViolationId ? { ...v, audioUrl: dataUrl } : v
          ));
          // If speech confirmed → also fire AUDIO_DETECTED
          const nowMs = performance.now();
          const speechInWindow =
            !speechSupported || isSpeechActive ||
            (speechEndedAt !== null && speechEndedAt >= triggerMs - 1000 && speechEndedAt <= nowMs + 500);
          if (speechInWindow) {
            addViolation('AUDIO_DETECTED', { detail: `Level ${avgLevel.toFixed(0)}, baseline ${baseline.toFixed(0)}` });
          }
        };
        reader.readAsDataURL(blob);
      };
      rec.start();
      audioRecorderRef.current = rec;
      setTimeout(() => {
        if (rec.state === 'recording') {
          rec.requestData();
          setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 100);
        }
      }, RECORD_DURATION_MS);
    };

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(micRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const check = () => {
        analyser.getByteFrequencyData(buf);
        const binSize = ctx.sampleRate / analyser.fftSize;
        const low = Math.floor(300 / binSize);
        const high = Math.ceil(3400 / binSize);
        let sum = 0;
        for (let i = low; i < high && i < buf.length; i++) sum += buf[i];
        const avg = sum / (high - low);
        setAudioLevel(avg);

        if (!calibrated) {
          calSamples.push(avg);
          if (calSamples.length >= CALIBRATION_FRAMES) {
            const sorted = [...calSamples].sort((a, b) => a - b);
            baseline = sorted[Math.floor(sorted.length * 0.80)];
            calibrated = true;
          }
          animFrame = requestAnimationFrame(check);
          return;
        }

        if (avg > baseline + NOISE_MARGIN) {
          voiceFrames++;
          if (voiceFrames >= 5 && !saving) {
            const nowMs = performance.now();
            voiceFrames = 0;
            if (nowMs - lastNoiseFlagMs > NOISE_COOLDOWN_MS) {
              lastNoiseFlagMs = nowMs;
              const vid = uid();
              const v: Violation = {
                id: vid, type: 'NOISE_DETECTED',
                label: VIOLATION_CONFIG['NOISE_DETECTED'].label,
                severity: VIOLATION_CONFIG['NOISE_DETECTED'].severity,
                timestamp: new Date(),
                detail: `Level ${avg.toFixed(0)}, baseline ${baseline.toFixed(0)}`,
              };
              snapStream(webcamRef.current).then(shot => {
                if (shot) { v.webcamShot = shot; logCapture('webcam', shot, 'violation'); }
                setViolations(prev => [...prev, v]);
                toast.warning(VIOLATION_TOAST['NOISE_DETECTED'], { duration: 4000 });
              });
              recordAndAttach(vid, nowMs, avg);
            }
          }
        } else {
          voiceFrames = Math.max(0, voiceFrames - 1);
        }
        animFrame = requestAnimationFrame(check);
      };
      check();

      return () => {
        cancelAnimationFrame(animFrame);
        try { recognition?.stop(); } catch { /**/ }
        audioRecorderRef.current?.stop();
        ctx.close();
      };
    } catch { /* audio context failed */ }
  }, [addViolation, logCapture, proctorEnabled]);

  // ══════════════════════════════════════════════════════════════════
  // FACE DETECTION + IDENTITY + GAZE
  // ══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!proctorEnabled) return;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    Object.assign(video.style, { position: 'fixed', opacity: '0', pointerEvents: 'none', width: '1px', height: '1px' });
    document.body.appendChild(video);
    video.srcObject = webcamRef.current;
    video.play().catch(() => {});

    let running = true;
    let missCount = 0, multiCount = 0, mismatchCount = 0;
    let lastCheck = 0;
    const CHECK_MS = 200;
    const GAZE_YAW_THRESHOLD = 25;
    const GAZE_PITCH_THRESHOLD = 30;
    const GAZE_AWAY_MS = 1500;

    const loop = async () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastCheck >= CHECK_MS) {
        lastCheck = now;
        const res = await detectFaces(video);
        if (res) {
          const count = res.faceLandmarks?.length ?? 0;
          if (count === 0) {
            multiCount = 0; mismatchCount = 0; missCount++;
            gazeAwayStartRef.current = null;
            // 3 misses at 200ms = ~0.6s, then violation. Resets to allow re-trigger.
            if (missCount >= 3) { setFaceStatus('none'); addViolation('NO_FACE'); missCount = 0; }
          } else if (count > 1) {
            missCount = 0; mismatchCount = 0; multiCount++;
            gazeAwayStartRef.current = null;
            if (multiCount >= 2) { setFaceStatus('multiple'); addViolation('MULTIPLE_FACES'); multiCount = 0; }
          } else {
            missCount = 0; multiCount = 0;

            // Gaze detection via head pose matrix
            const matrix = res.facialTransformationMatrixes?.[0]?.data;
            if (matrix) {
              const yaw = getHeadYaw(matrix as unknown as number[]);
              const pitch = getHeadPitch(matrix as unknown as number[]);
              const lookingAway = Math.abs(yaw) > GAZE_YAW_THRESHOLD || Math.abs(pitch) > GAZE_PITCH_THRESHOLD;
              if (lookingAway) {
                if (!gazeAwayStartRef.current) gazeAwayStartRef.current = now;
                const awayMs = now - gazeAwayStartRef.current;
                if (awayMs >= GAZE_AWAY_MS) {
                  setFaceStatus('mismatch');
                  addViolation('GAZE_AWAY', { detail: `Yaw: ${yaw.toFixed(0)}°, Pitch: ${pitch.toFixed(0)}°` });
                  gazeAwayStartRef.current = now;
                }
              } else {
                gazeAwayStartRef.current = null;
              }
            }

            // Identity check using landmark embedding
            const landmarks = res.faceLandmarks[0];
            const emb = extractEmbeddingFromLandmarks(landmarks);
            if (emb && embeddingRef.current) {
              const sim = cosineSimilarity(emb, embeddingRef.current);
              if (sim < 0.72) {
                mismatchCount++;
                if (mismatchCount >= 3) {
                  setFaceStatus('mismatch');
                  addViolation('IDENTITY_MISMATCH', { detail: `Similarity: ${(sim * 100).toFixed(0)}%`, skipCooldown: true });
                  mismatchCount = 0;
                }
              } else {
                mismatchCount = 0;
                if (!gazeAwayStartRef.current) setFaceStatus('ok');
              }
            } else {
              mismatchCount = 0;
              if (!gazeAwayStartRef.current) setFaceStatus('ok');
            }
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return () => { running = false; video.pause(); video.srcObject = null; video.remove(); };
  }, [addViolation, proctorEnabled]);

  // Periodic captures
  useEffect(() => {
    if (!proctorEnabled) return;
    const interval = setInterval(async () => {
      const [wShot, sShot] = await Promise.all([
        snapStream(webcamRef.current),
        snapStream(screenRef.current),
      ]);
      if (wShot) logCapture('webcam', wShot, 'periodic');
      if (sShot) logCapture('screen', sShot, 'periodic');
    }, 7_000);
    return () => clearInterval(interval);
  }, [logCapture, proctorEnabled]);

  const stopAll = useCallback(() => {
    webcamRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current?.getTracks().forEach(t => t.stop());
    micRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const doFinish = useCallback((cb: typeof onTimeUp) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (screenCountdownRef.current) clearInterval(screenCountdownRef.current);
    stopAll();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    cb({
      violations: violationsRef.current,
      captureLogs: captureLogsRef.current,
      audioClips: audioClipsRef.current,
      timeSpent: durationSeconds - timeLeft,
    });
  }, [stopAll, durationSeconds, timeLeft]);

  const requestSubmit = useCallback(() => { setPendingSubmit(true); }, []);
  const confirmSubmit = useCallback(() => {
    setPendingSubmit(false);
    doFinish(onManualSubmit);
  }, [doFinish, onManualSubmit]);

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { doFinish(onTimeUp); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [doFinish, onTimeUp]);

  const urgent = timeLeft <= 60;
  const audioBar = Math.min(100, (audioLevel / 50) * 100);
  const faceColors = { ok: 'bg-success/10 text-success', none: 'bg-destructive/10 text-destructive', multiple: 'bg-destructive/10 text-destructive', mismatch: 'bg-warning/10 text-warning' };
  const faceLabels = { ok: 'Face ✓', none: 'No Face', multiple: 'Multi-Face', mismatch: 'Identity?' };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Fullscreen overlay */}
      {fullscreenBlocked && proctorEnabled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <Maximize className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Fullscreen Required</h2>
              <p className="text-sm text-muted-foreground">
                You exited fullscreen. This has been recorded. Return to fullscreen to continue.
              </p>
              <Button onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
                Return to Fullscreen
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Multi-monitor overlay */}
      {multiMonitorBlocked && proctorEnabled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                <Monitor className="h-8 w-8 text-warning" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Multiple Displays Detected</h2>
              <p className="text-sm text-muted-foreground">
                Please disconnect all external displays and return to a single monitor.
              </p>
              <p className="text-xs text-muted-foreground">
                The exam will resume automatically when only one screen is detected.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Screen share lost — countdown overlay */}
      {screenShareCountdown !== null && proctorEnabled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <Monitor className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Screen Sharing Stopped</h2>
              <p className="text-sm text-muted-foreground">
                Your screen share was interrupted. Resume sharing within{' '}
                <span className="font-bold text-destructive">{screenShareCountdown}s</span> or the exam will end.
              </p>
              <p className="text-xs text-muted-foreground">
                Note: Stopping screen share a second time will end the exam immediately.
              </p>
              <Button onClick={handleReshareScreen}>
                <Monitor className="mr-2 h-4 w-4" /> Share Screen Again
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Submit confirmation overlay */}
      {pendingSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <h2 className="text-xl font-semibold text-foreground">Submit Examination?</h2>
              <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={() => setPendingSubmit(false)}>Cancel</Button>
                <Button onClick={confirmSubmit}>Submit Exam</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Proctor header bar */}
      <header className="sticky top-0 z-40 border-b bg-card px-4 py-2">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{examTitle}</p>
            {!proctorEnabled && (
              <Badge variant="secondary" className="text-[10px]">Proctor Off</Badge>
            )}
          </div>

          <div className={`text-2xl font-bold font-mono ${urgent ? 'text-destructive animate-pulse' : 'text-foreground'}`}>
            <Clock className="inline-block mr-1 h-5 w-5" />
            {formatTime(timeLeft)}
          </div>

          <div className="flex items-center gap-2">
            {proctorEnabled && (
              <>
                <Badge variant="outline" className={`text-xs ${faceColors[faceStatus]}`}>
                  <Eye className="mr-1 h-3 w-3" /> {faceLabels[faceStatus]}
                </Badge>
                <Badge variant="outline" className={`text-xs ${screenOk ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                  <Monitor className="mr-1 h-3 w-3" /> {screenOk ? 'Screen ✓' : 'No Screen'}
                </Badge>
                <div className="flex items-center gap-1">
                  <Mic className="h-3 w-3 text-muted-foreground" />
                  <div className="h-2 w-10 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-100"
                      style={{
                        width: `${audioBar}%`,
                        backgroundColor: audioBar > 80 ? 'hsl(var(--destructive))' : audioBar > 40 ? 'hsl(var(--warning))' : 'hsl(var(--success))'
                      }}
                    />
                  </div>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                      <AlertTriangle className="h-3 w-3" />
                      {violations.length}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72" align="end">
                    <p className="text-sm font-medium mb-2">Recent Violations</p>
                    {violations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No violations yet</p>
                    ) : (
                      <div className="max-h-48 space-y-1.5 overflow-y-auto">
                        {violations.slice(-5).reverse().map(v => (
                          <div key={v.id} className="flex items-center gap-2 rounded bg-muted p-1.5 text-xs">
                            <Badge variant={v.severity === 'error' ? 'destructive' : 'secondary'} className="text-[10px] px-1.5 py-0">
                              {v.severity}
                            </Badge>
                            <span className="flex-1 truncate">{v.label}</span>
                            <span className="text-muted-foreground">{v.timestamp.toLocaleTimeString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Child content area */}
      <div className="flex-1">
        {children({
          violations, captureLogs, audioClips,
          faceStatus, screenOk, audioLevel, timeLeft,
          requestSubmit,
        })}
      </div>
    </div>
  );
}
