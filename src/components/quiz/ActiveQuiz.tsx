import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Eye, Mic, Monitor, Send, Shield, Volume2, Camera, Maximize } from 'lucide-react';
import {
  type Violation, type CaptureLog, type AudioClip, type ViolationType,
  QUESTIONS, QUIZ_DURATION, VIOLATION_CONFIG, uid, formatTime,
} from '@/lib/quiz-types';
import { detectFaces, extractEmbedding, cosineSimilarity, snapStream } from '@/lib/proctoring';

interface ActiveQuizProps {
  webcamStream: MediaStream;
  micStream: MediaStream;
  screenStream: MediaStream;
  referenceEmbedding: number[] | null;
  onFinish: (data: {
    answers: Record<number, number>;
    violations: Violation[];
    captureLogs: CaptureLog[];
    audioClips: AudioClip[];
    timeSpent: number;
  }) => void;
}

export default function ActiveQuiz({ webcamStream, micStream, screenStream, referenceEmbedding, onFinish }: ActiveQuizProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [violations, setViolations] = useState<Violation[]>([]);
  const [captureLogs, setCaptureLogs] = useState<CaptureLog[]>([]);
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION);
  const [currentQ, setCurrentQ] = useState(0);
  const [faceStatus, setFaceStatus] = useState<'ok' | 'none' | 'multiple' | 'mismatch'>('ok');
  const [screenOk, setScreenOk] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [multiMonitorBlocked, setMultiMonitorBlocked] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

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
  const answersRef = useRef<Record<number, number>>({});

  useEffect(() => { violationsRef.current = violations; }, [violations]);
  useEffect(() => { captureLogsRef.current = captureLogs; }, [captureLogs]);
  useEffect(() => { answersRef.current = answers; }, [answers]);

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

    // Multiple monitor detection with blocking
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

  // Audio monitoring — only trigger after 3+ seconds of sustained speech
  useEffect(() => {
    let animFrame: number;
    let recorder: MediaRecorder | null = null;
    let voiceStartTime: number | null = null; // when sustained voice started
    let violated = false; // whether we already fired for this speech segment

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(micRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      // Start a pre-recording buffer so we capture from the start of speech
      let preRecorder: MediaRecorder | null = null;
      let preChunks: BlobPart[] = [];
      const startPreRecording = () => {
        try {
          preChunks = [];
          preRecorder = new MediaRecorder(micRef.current, { mimeType: 'audio/webm' });
          preRecorder.ondataavailable = e => { if (e.data.size > 0) preChunks.push(e.data); };
          preRecorder.start(500); // collect in 500ms chunks
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

        if (avg > 56) {
          if (!voiceStartTime) voiceStartTime = now;

          // 3 seconds of sustained audio → violation + start recording
          if (!violated && now - voiceStartTime >= 3000) {
            violated = true;
            addViolation('AUDIO_DETECTED', { detail: `Sustained speech detected (${((now - voiceStartTime) / 1000).toFixed(1)}s)` });

            // Stop pre-recorder, start a proper recording that includes the buffered data
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
          // Reset when audio drops — give 500ms grace before resetting
          if (voiceStartTime && now - voiceStartTime > 500) {
            voiceStartTime = null;
            violated = false;
            // Restart pre-recording for next potential speech
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
            // Require 5 consecutive misses (~7.5s) before triggering NO_FACE violation
            if (missCount >= 5) { setFaceStatus('none'); addViolation('NO_FACE'); missCount = 3; }
            else if (missCount >= 2) { setFaceStatus('none'); } // show status early but don't violate
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

  const handleSubmit = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopAll();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onFinish({
      answers: answersRef.current,
      violations: violationsRef.current,
      captureLogs: captureLogsRef.current,
      audioClips: audioClipsRef.current,
      timeSpent: QUIZ_DURATION - timeLeft,
    });
  }, [stopAll, onFinish, timeLeft]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleSubmit(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [handleSubmit]);

  const q = QUESTIONS[currentQ];
  const urgent = timeLeft <= 60;
  const audioBar = Math.min(100, (audioLevel / 60) * 100);
  const faceColors = { ok: 'bg-success/10 text-success', none: 'bg-destructive/10 text-destructive', multiple: 'bg-destructive/10 text-destructive', mismatch: 'bg-warning/10 text-warning' };
  const faceLabels = { ok: 'Face ✓', none: 'No Face', multiple: 'Multi-Face', mismatch: 'Identity?' };

  return (
    <div className="flex min-h-screen flex-col bg-background">
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

      {multiMonitorBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <Card className="w-full max-w-md text-center">
            <CardContent className="pt-8 pb-6 space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
                <Monitor className="h-8 w-8 text-warning" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Multiple Monitors Detected</h2>
              <p className="text-sm text-muted-foreground">
                Please disconnect all external displays and return to a single monitor to continue. This violation has been recorded.
              </p>
              <p className="text-xs text-muted-foreground">
                The exam will resume automatically when only one screen is detected.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b bg-card px-4 py-2">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CS101 Midterm</p>
              <p className="text-sm font-medium text-foreground">Question {currentQ + 1} of {QUESTIONS.length}</p>
            </div>
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

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-2">
                <Badge variant="secondary" className="mb-2">Question {currentQ + 1}</Badge>
                <h2 className="text-xl font-semibold text-foreground">{q.question}</h2>
              </div>

              <div className="space-y-3">
                {q.options.map((opt, i) => {
                  const selected = answers[q.id] === i;
                  return (
                    <button
                      key={i}
                      onClick={() => setAnswers(a => ({ ...a, [q.id]: i }))}
                      className={`w-full flex items-center gap-3 rounded-lg border p-4 text-left transition-all hover:border-primary/50 hover:bg-primary/5 ${
                        selected ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border'
                      }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}>
                        {String.fromCharCode(65 + i)}
                      </div>
                      <span className={`text-sm ${selected ? 'font-medium text-foreground' : 'text-foreground'}`}>{opt}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="sticky bottom-0 border-t bg-card px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
            disabled={currentQ === 0}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>

          <div className="flex items-center gap-1.5">
            {QUESTIONS.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                className={`h-2.5 w-2.5 rounded-full transition-all ${
                  i === currentQ ? 'scale-125 ring-2 ring-primary ring-offset-2 ring-offset-card bg-primary' :
                  answers[QUESTIONS[i].id] !== undefined ? 'bg-primary' : 'bg-border'
                }`}
              />
            ))}
          </div>

          {currentQ < QUESTIONS.length - 1 ? (
            <Button onClick={() => setCurrentQ(q => q + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => setShowSubmitDialog(true)} className="bg-success hover:bg-success/90 text-success-foreground">
              <Send className="mr-1 h-4 w-4" /> Submit
            </Button>
          )}
        </div>
      </footer>

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Examination?</DialogTitle>
            <DialogDescription>
              You have answered {Object.keys(answers).length} of {QUESTIONS.length} questions.
              {Object.keys(answers).length < QUESTIONS.length && ' Some questions are unanswered.'}
              {' '}This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>Review Answers</Button>
            <Button onClick={handleSubmit}>Submit Exam</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
