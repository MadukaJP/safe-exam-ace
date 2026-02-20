import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, Eye, Mic, Monitor, Maximize, Shield, Clock } from 'lucide-react';
import {
  type Violation, type CaptureLog, type AudioClip, type ViolationType,
  VIOLATION_CONFIG, uid, formatTime,
} from '@/lib/quiz-types';
import { detectFaces, extractEmbedding, cosineSimilarity, snapStream } from '@/lib/proctoring';

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
  examTitle?: string;
  onTimeUp: (data: { violations: Violation[]; captureLogs: CaptureLog[]; audioClips: AudioClip[]; timeSpent: number }) => void;
  onManualSubmit: (data: { violations: Violation[]; captureLogs: CaptureLog[]; audioClips: AudioClip[]; timeSpent: number }) => void;
  children: (data: ProctorData & { requestSubmit: () => void }) => ReactNode;
}

export default function ProctorWrapper({
  webcamStream, micStream, screenStream, referenceEmbedding,
  durationSeconds, examTitle = 'Proctored Exam',
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

  useEffect(() => { violationsRef.current = violations; }, [violations]);
  useEffect(() => { captureLogsRef.current = captureLogs; }, [captureLogs]);

  const logCapture = useCallback((kind: 'webcam' | 'screen', dataUrl: string, trigger: CaptureLog['trigger']) => {
    const entry: CaptureLog = { id: uid(), timestamp: new Date(), kind, dataUrl, trigger };
    setCaptureLogs(prev => [...prev, entry]);
  }, []);

  const addViolation = useCallback(async (
    type: ViolationType,
    opts: { captureScreen?: boolean; awayMs?: number; detail?: string; skipCooldown?: boolean } = {}
  ) => {
    const now = Date.now();
    if (!opts.skipCooldown && type !== 'TAB_SWITCH' && (cooldownRef.current[type] ?? 0) + 10_000 > now) return;
    cooldownRef.current[type] = now;

    const cfg = VIOLATION_CONFIG[type];
    (cfg.severity === 'error' ? toast.error : toast.warning)(
      `⚠️ ${cfg.label}`,
      { description: opts.awayMs ? `Away ${(opts.awayMs / 1000).toFixed(1)}s` : opts.detail ?? 'Recorded.', duration: 4000 }
    );

    const [webcamShot, screenShot] = await Promise.all([
      snapStream(webcamRef.current),
      opts.captureScreen ? snapStream(screenRef.current) : Promise.resolve(undefined),
    ]);

    const v: Violation = {
      id: uid(), type, label: cfg.label, severity: cfg.severity,
      timestamp: new Date(), webcamShot, screenShot, awayMs: opts.awayMs, detail: opts.detail,
    };
    setViolations(prev => [...prev, v]);
    if (webcamShot) logCapture('webcam', webcamShot, 'violation');
    if (screenShot) logCapture('screen', screenShot, 'violation');
  }, [logCapture]);

  // Keyboard blocking
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
        addViolation('KEYBOARD_SHORTCUT', { detail: `${ctrl ? 'Ctrl+' : ''}${shift ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${key}` });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [addViolation]);

  // Tab, clipboard, fullscreen, multi-monitor, devtools
  useEffect(() => {
    const onVisibility = async () => {
      if (document.hidden) {
        tabHiddenAtRef.current = Date.now();
      } else {
        const awayMs = tabHiddenAtRef.current ? Date.now() - tabHiddenAtRef.current : undefined;
        tabHiddenAtRef.current = null;
        await addViolation('TAB_SWITCH', { captureScreen: true, awayMs });
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

    const checkMonitors = () => {
      if ((window.screen as any).isExtended) {
        setMultiMonitorBlocked(true);
        addViolation('MULTIPLE_MONITORS', { detail: 'Extended display detected' });
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

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onClip as EventListener);
    document.addEventListener('cut', onClip as EventListener);
    document.addEventListener('paste', onClip as EventListener);
    document.addEventListener('contextmenu', onCtx);
    document.addEventListener('fullscreenchange', onFs);

    const track = screenRef.current?.getVideoTracks()[0];
    const onEnded = () => { setScreenOk(false); addViolation('SCREEN_SHARE_STOPPED'); };
    track?.addEventListener('ended', onEnded);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onClip as EventListener);
      document.removeEventListener('cut', onClip as EventListener);
      document.removeEventListener('paste', onClip as EventListener);
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('fullscreenchange', onFs);
      track?.removeEventListener('ended', onEnded);
      clearInterval(devtools);
      clearInterval(monitorInterval);
    };
  }, [addViolation, logCapture]);

  // Audio monitoring — lowered threshold to 35 for low talking detection
  useEffect(() => {
    let animFrame: number;
    let recorder: MediaRecorder | null = null;
    let voiceStartTime: number | null = null;
    let violated = false;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(micRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      let preRecorder: MediaRecorder | null = null;
      let preChunks: BlobPart[] = [];
      const startPreRecording = () => {
        try {
          preChunks = [];
          preRecorder = new MediaRecorder(micRef.current, { mimeType: 'audio/webm' });
          preRecorder.ondataavailable = e => { if (e.data.size > 0) preChunks.push(e.data); };
          preRecorder.start(500);
        } catch { preRecorder = null; }
      };
      startPreRecording();

      const check = () => {
        analyser.getByteFrequencyData(buf);
        const binSize = ctx.sampleRate / analyser.fftSize;
        const low = Math.floor(300 / binSize);
        const high = Math.ceil(3400 / binSize);
        let sum = 0;
        for (let i = low; i < high && i < buf.length; i++) sum += buf[i];
        const avg = sum / (high - low);
        setAudioLevel(avg);

        const now = Date.now();

        if (avg > 35) {
          if (!voiceStartTime) voiceStartTime = now;

          if (!violated && now - voiceStartTime >= 3000) {
            violated = true;
            addViolation('AUDIO_DETECTED', { detail: `Sustained speech detected (${((now - voiceStartTime) / 1000).toFixed(1)}s)` });

            if (preRecorder && preRecorder.state !== 'inactive') {
              preRecorder.stop();
            }

            if (!recorder || recorder.state === 'inactive') {
              try {
                const chunks: BlobPart[] = [...preChunks];
                recorder = new MediaRecorder(micRef.current, { mimeType: 'audio/webm' });
                recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                  const blob = new Blob(chunks, { type: 'audio/webm' });
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const clip: AudioClip = { timestamp: new Date(), dataUrl: reader.result as string };
                    audioClipsRef.current = [...audioClipsRef.current, clip];
                    setAudioClips(prev => [...prev, clip]);
                  };
                  reader.readAsDataURL(blob);
                };
                recorder.start();
                setTimeout(() => { recorder?.stop(); recorder = null; }, 10000);
              } catch { }
            }
          }
        } else {
          if (voiceStartTime && now - voiceStartTime > 500) {
            voiceStartTime = null;
            violated = false;
            if (!preRecorder || preRecorder.state === 'inactive') {
              startPreRecording();
            }
          }
        }
        animFrame = requestAnimationFrame(check);
      };
      check();

      return () => {
        cancelAnimationFrame(animFrame);
        recorder?.stop();
        preRecorder?.stop();
        ctx.close();
      };
    } catch { }
  }, [addViolation]);

  // Face detection
  useEffect(() => {
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

    const loop = async () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastCheck >= 1500) {
        lastCheck = now;
        const res = await detectFaces(video);
        if (res) {
          const count = res.detections.length;
          if (count === 0) {
            multiCount = 0; mismatchCount = 0; missCount++;
            if (missCount >= 5) { setFaceStatus('none'); addViolation('NO_FACE'); missCount = 3; }
            else if (missCount >= 2) { setFaceStatus('none'); }
          } else if (count > 1) {
            missCount = 0; mismatchCount = 0; multiCount++;
            if (multiCount >= 2) { setFaceStatus('multiple'); addViolation('MULTIPLE_FACES'); }
          } else {
            missCount = 0; multiCount = 0;
            const box = res.detections[0].boundingBox!;
            const emb = extractEmbedding(video, { originX: box.originX, originY: box.originY, width: box.width, height: box.height });
            if (emb && embeddingRef.current) {
              const sim = cosineSimilarity(emb, embeddingRef.current);
              if (sim < 0.72) {
                mismatchCount++;
                if (mismatchCount >= 3) { setFaceStatus('mismatch'); addViolation('IDENTITY_MISMATCH', { detail: `Similarity: ${(sim * 100).toFixed(0)}%` }); }
              } else { mismatchCount = 0; setFaceStatus('ok'); }
            } else { mismatchCount = 0; setFaceStatus('ok'); }
          }
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return () => { running = false; video.pause(); video.srcObject = null; video.remove(); };
  }, [addViolation]);

  // Periodic captures
  useEffect(() => {
    const interval = setInterval(async () => {
      const [wShot, sShot] = await Promise.all([
        snapStream(webcamRef.current),
        snapStream(screenRef.current),
      ]);
      if (wShot) logCapture('webcam', wShot, 'periodic');
      if (sShot) logCapture('screen', sShot, 'periodic');
    }, 15_000);
    return () => clearInterval(interval);
  }, [logCapture]);

  const stopAll = useCallback(() => {
    webcamRef.current?.getTracks().forEach(t => t.stop());
    screenRef.current?.getTracks().forEach(t => t.stop());
    micRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const doFinish = useCallback((cb: typeof onTimeUp) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    stopAll();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    cb({
      violations: violationsRef.current,
      captureLogs: captureLogsRef.current,
      audioClips: audioClipsRef.current,
      timeSpent: durationSeconds - timeLeft,
    });
  }, [stopAll, durationSeconds, timeLeft]);

  const requestSubmit = useCallback(() => {
    setPendingSubmit(true);
  }, []);

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
      {fullscreenBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <Maximize className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Fullscreen Required</h2>
              <p className="text-sm text-muted-foreground">
                You exited fullscreen. This has been recorded as a violation. Return to fullscreen to continue.
              </p>
              <Button onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
                Return to Fullscreen
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Multi-monitor overlay */}
      {multiMonitorBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                <Monitor className="h-8 w-8 text-warning" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Multiple Monitors Detected</h2>
              <p className="text-sm text-muted-foreground">
                Please disconnect all external displays and return to a single monitor to continue.
              </p>
              <p className="text-xs text-muted-foreground">
                The exam will resume automatically when only one screen is detected.
              </p>
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
          </div>

          <div className={`text-2xl font-bold font-mono ${urgent ? 'text-destructive animate-pulse-red' : 'text-foreground'}`}>
            <Clock className="inline-block mr-1 h-5 w-5" />
            {formatTime(timeLeft)}
          </div>

          <div className="flex items-center gap-2">
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
