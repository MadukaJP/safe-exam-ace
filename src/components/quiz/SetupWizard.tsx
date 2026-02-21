import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, X, Loader2, Mic, Camera, Monitor, ChevronRight, AlertTriangle, Volume2, Eye, Keyboard, Copy, Globe, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getLandmarker, detectFaces, extractEmbeddingFromLandmarks, detectMultipleMonitors } from '@/lib/proctoring';

interface SetupWizardProps {
  onComplete: (data: {
    webcamStream: MediaStream;
    micStream: MediaStream;
    screenStream: MediaStream;
    referenceEmbedding: number[] | null;
    proctorEnabled: boolean;
  }) => void;
  onBack: () => void;
}

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { num: 1, label: 'System Check' },
  { num: 2, label: 'Microphone' },
  { num: 3, label: 'Camera' },
  { num: 4, label: 'Screen Share' },
];

interface SystemCheck {
  label: string;
  status: 'pending' | 'checking' | 'pass' | 'fail';
  detail?: string;
}

export default function SetupWizard({ onComplete, onBack }: SetupWizardProps) {
  const [step, setStep] = useState<Step>(1);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Stepper */}
      <div className="border-b bg-card px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  step > s.num ? 'bg-success text-success-foreground' :
                  step === s.num ? 'bg-primary text-primary-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step > s.num ? <Check className="h-4 w-4" /> : s.num}
                </div>
                <span className={`hidden text-sm font-medium sm:inline ${
                  step >= s.num ? 'text-foreground' : 'text-muted-foreground'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-3 h-px w-8 sm:w-16 ${step > s.num ? 'bg-success' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-xl">
          {step === 1 && <SystemCheckStep onNext={() => setStep(2)} onBack={onBack} />}
          {step === 2 && <MicCheckStep onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <CameraCheckStep onNext={() => setStep(4)} onBack={() => setStep(2)} />}
          {step === 4 && <ScreenShareStep onBack={() => setStep(3)} onComplete={onComplete} />}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: System Compatibility ─────────────────────────────────────────────

function SystemCheckStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [checks, setChecks] = useState<SystemCheck[]>([
    { label: 'Browser Compatibility', status: 'pending' },
    { label: 'Screen Resolution', status: 'pending' },
    { label: 'Webcam Available', status: 'pending' },
    { label: 'Microphone Available', status: 'pending' },
    { label: 'Single Monitor', status: 'pending' },
  ]);
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const update = (idx: number, patch: Partial<SystemCheck>) =>
      setChecks(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));

    const run = async () => {
      update(0, { status: 'checking' });
      await new Promise(r => setTimeout(r, 600));
      const hasMedia = !!navigator.mediaDevices?.getUserMedia;
      update(0, { status: hasMedia ? 'pass' : 'fail', detail: hasMedia ? 'MediaDevices API supported' : 'Browser does not support required APIs' });

      update(1, { status: 'checking' });
      await new Promise(r => setTimeout(r, 400));
      const w = window.screen.width, h = window.screen.height;
      const resOk = w >= 1024 && h >= 600;
      update(1, { status: resOk ? 'pass' : 'fail', detail: `${w}×${h}${resOk ? '' : ' — minimum 1024×600 required'}` });

      update(2, { status: 'checking' });
      await new Promise(r => setTimeout(r, 300));
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCam = devices.some(d => d.kind === 'videoinput');
        update(2, { status: hasCam ? 'pass' : 'fail', detail: hasCam ? 'Camera device found' : 'No camera detected' });
      } catch { update(2, { status: 'fail', detail: 'Cannot enumerate devices' }); }

      update(3, { status: 'checking' });
      await new Promise(r => setTimeout(r, 300));
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some(d => d.kind === 'audioinput');
        update(3, { status: hasMic ? 'pass' : 'fail', detail: hasMic ? 'Microphone device found' : 'No microphone detected' });
      } catch { update(3, { status: 'fail', detail: 'Cannot enumerate devices' }); }

      // Monitor check
      update(4, { status: 'checking' });
      await new Promise(r => setTimeout(r, 300));
      const { detected, reason } = detectMultipleMonitors();
      update(4, { status: detected ? 'fail' : 'pass', detail: detected ? reason : 'Single monitor detected' });

      setDone(true);
    };
    run();
  }, []);

  const allPassed = done && checks.every(c => c.status === 'pass');

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Compatibility</CardTitle>
        <CardDescription>We'll check that your device meets the requirements</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              c.status === 'pass' ? 'bg-success/10 text-success' :
              c.status === 'fail' ? 'bg-destructive/10 text-destructive' :
              c.status === 'checking' ? 'bg-primary/10 text-primary' :
              'bg-muted text-muted-foreground'
            }`}>
              {c.status === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> :
               c.status === 'pass' ? <Check className="h-4 w-4" /> :
               c.status === 'fail' ? <X className="h-4 w-4" /> :
               <div className="h-2 w-2 rounded-full bg-current" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{c.label}</p>
              {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
            </div>
          </div>
        ))}
        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={onNext} disabled={!allPassed}>
            Continue <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Microphone Check ─────────────────────────────────────────────────

function MicCheckStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'requesting' | 'active' | 'confirmed' | 'error'>('idle');
  const [level, setLevel] = useState(0);
  const [confirmFrames, setConfirmFrames] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const startMicCheck = useCallback(async () => {
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      setStatus('active');

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let frames = 0;

      const check = () => {
        analyser.getByteFrequencyData(buf);
        const binSize = ctx.sampleRate / analyser.fftSize;
        const low = Math.floor(300 / binSize);
        const high = Math.ceil(3400 / binSize);
        let sum = 0;
        for (let i = low; i < high && i < buf.length; i++) sum += buf[i];
        const avg = sum / (high - low);
        setLevel(Math.min(100, (avg / 80) * 100));

        if (avg > 40) {
          frames++;
          setConfirmFrames(Math.min(frames, 30));
          if (frames >= 30) {
            setStatus('confirmed');
            return;
          }
        } else {
          frames = Math.max(0, frames - 1);
          setConfirmFrames(Math.max(0, frames));
        }
        rafRef.current = requestAnimationFrame(check);
      };
      check();
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close();
    };
  }, []);

  const handleNext = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close();
    ctxRef.current = null;
    (window as any).__proctoredMicStream = streamRef.current;
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
          <Mic className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-center">Microphone Check</CardTitle>
        <CardDescription className="text-center">
          {status === 'idle' && 'Click below to test your microphone'}
          {status === 'requesting' && 'Requesting microphone access...'}
          {status === 'active' && 'Speak something to verify your microphone works'}
          {status === 'confirmed' && 'Microphone verified successfully!'}
          {status === 'error' && 'Microphone permission was denied'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {(status === 'active' || status === 'confirmed') && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-100"
                    style={{
                      width: `${level}%`,
                      backgroundColor: status === 'confirmed' ? 'hsl(var(--success))' :
                        level > 60 ? 'hsl(var(--warning))' : 'hsl(var(--primary))'
                    }}
                  />
                </div>
              </div>
            </div>
            {status === 'active' && (
              <div className="space-y-1">
                <Progress value={(confirmFrames / 30) * 100} className="h-1.5" />
                <p className="text-xs text-muted-foreground text-center">
                  Keep speaking... {Math.round((confirmFrames / 30) * 100)}%
                </p>
              </div>
            )}
            {status === 'confirmed' && (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-success/10 p-3">
                <Check className="h-5 w-5 text-success" />
                <span className="text-sm font-medium text-success">Microphone working</span>
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span className="text-sm text-destructive">Please allow microphone access and try again</span>
          </div>
        )}

        {(status === 'idle' || status === 'error') && (
          <div className="flex justify-center">
            <Button onClick={startMicCheck}>
              <Mic className="mr-2 h-4 w-4" />
              {status === 'error' ? 'Retry' : 'Test Microphone'}
            </Button>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={handleNext} disabled={status !== 'confirmed'}>
            Continue <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 3: Camera & Identity ────────────────────────────────────────────────

function CameraCheckStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'streaming' | 'face_ok' | 'no_face' | 'multiple' | 'error'>('idle');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const embeddingRef = useRef<number[] | null>(null);

  const startCamera = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      await getLandmarker();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus('streaming');

      let streak = 0;
      pollRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        const res = await detectFaces(videoRef.current);
        if (!res) return;
        const count = res.faceLandmarks?.length ?? 0;
        if (count === 1) {
          streak++;
          if (streak >= 3) {
            // Capture landmark-based embedding
            embeddingRef.current = extractEmbeddingFromLandmarks(res.faceLandmarks[0]);
            setStatus('face_ok');
          } else {
            setStatus('streaming');
          }
        } else {
          streak = 0;
          setStatus(count === 0 ? 'no_face' : 'multiple');
        }
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera permission denied');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleNext = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    (window as any).__proctoredCamStream = streamRef.current;
    (window as any).__proctoredEmbedding = embeddingRef.current;
    onNext();
  };

  const statusMessage = {
    idle: 'Click below to start your camera',
    loading: 'Loading face detection model...',
    streaming: 'Position your face in the frame...',
    face_ok: '✓ Identity captured successfully',
    no_face: 'No face detected — sit directly in front of camera',
    multiple: 'Multiple faces detected — only you should be visible',
    error: error,
  }[status];

  return (
    <Card>
      <CardHeader>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
          <Camera className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-center">Camera & Identity</CardTitle>
        <CardDescription className="text-center">{statusMessage}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-xl border-2 border-border bg-muted">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover [transform:scaleX(-1)]"
          />
          {(status === 'streaming' || status === 'no_face' || status === 'multiple') && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-48 w-36 rounded-[50%] border-2 border-dashed border-primary/50" />
            </div>
          )}
          {status === 'face_ok' && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-success text-success-foreground">
                <Check className="mr-1 h-3 w-3" /> Identity Captured
              </Badge>
            </div>
          )}
          {status === 'no_face' && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Badge variant="destructive">No Face Detected</Badge>
            </div>
          )}
          {status === 'multiple' && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-warning text-warning-foreground">Multiple Faces</Badge>
            </div>
          )}
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}
          {status === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Camera className="h-12 w-12 text-muted-foreground/50" />
            </div>
          )}
        </div>

        {(status === 'idle' || status === 'error') && (
          <div className="flex justify-center">
            <Button onClick={startCamera}>
              <Camera className="mr-2 h-4 w-4" />
              {status === 'error' ? 'Retry' : 'Start Camera'}
            </Button>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={handleNext} disabled={status !== 'face_ok'}>
            Continue <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 4: Screen Share & Rules ─────────────────────────────────────────────

function ScreenShareStep({ onBack, onComplete }: {
  onBack: () => void;
  onComplete: SetupWizardProps['onComplete'];
}) {
  const [agreed, setAgreed] = useState(false);
  const [proctorEnabled, setProctorEnabled] = useState(true);
  const [starting, setStarting] = useState(false);

  const rules = [
    { icon: Eye, label: 'Tab switching is monitored', desc: 'Screenshots are captured when you leave' },
    { icon: Camera, label: 'Face must remain visible', desc: 'Continuous face detection and identity checks' },
    { icon: Mic, label: 'Audio is monitored', desc: 'Voice activity triggers recording' },
    { icon: Monitor, label: 'Fullscreen is required', desc: 'Exiting fullscreen records a violation' },
    { icon: Copy, label: 'No copy/paste', desc: 'Clipboard and right-click are disabled' },
    { icon: Keyboard, label: 'Shortcuts blocked', desc: 'DevTools and system shortcuts are intercepted' },
  ];

  const handleStart = async () => {
    setStarting(true);
    try {
      toast.info('Please share your ENTIRE SCREEN when prompted', { duration: 5000 });
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
        audio: false,
      });
      const surface = (screenStream.getVideoTracks()[0].getSettings() as any).displaySurface;
      if (surface && surface !== 'monitor') {
        screenStream.getTracks().forEach(t => t.stop());
        toast.error('You must share your entire screen, not a tab or window.');
        setStarting(false);
        return;
      }

      await document.documentElement.requestFullscreen();

      const micStream = (window as any).__proctoredMicStream as MediaStream | null;
      const webcamStream = (window as any).__proctoredCamStream as MediaStream | null;
      const embedding = (window as any).__proctoredEmbedding as number[] | null;

      delete (window as any).__proctoredMicStream;
      delete (window as any).__proctoredCamStream;
      delete (window as any).__proctoredEmbedding;

      if (!webcamStream || !micStream) {
        toast.error('Camera or microphone stream lost. Please restart setup.');
        setStarting(false);
        return;
      }

      onComplete({
        webcamStream,
        micStream,
        screenStream,
        referenceEmbedding: embedding,
        proctorEnabled,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start');
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-3">
          <Monitor className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-center">Exam Rules & Screen Share</CardTitle>
        <CardDescription className="text-center">
          Review the proctoring rules before beginning
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Proctor toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Globe className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Enable Proctoring</p>
              <p className="text-xs text-muted-foreground">
                {proctorEnabled ? 'All monitoring features active' : 'Monitoring disabled — exam runs without proctoring'}
              </p>
            </div>
          </div>
          <Switch checked={proctorEnabled} onCheckedChange={setProctorEnabled} />
        </div>

        {proctorEnabled && (
          <div className="grid gap-2">
            {rules.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Checkbox
            id="agree"
            checked={agreed}
            onCheckedChange={(v) => setAgreed(!!v)}
            className="mt-0.5"
          />
          <label htmlFor="agree" className="text-sm text-foreground cursor-pointer">
            {proctorEnabled
              ? 'I understand and agree to the proctoring terms. I am aware that my webcam, microphone, and screen will be monitored throughout the examination.'
              : 'I understand and agree to proceed with the examination without proctoring.'
            }
          </label>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button onClick={handleStart} disabled={!agreed || starting}>
            {starting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting...</>
            ) : (
              <>Share Screen & Begin</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
