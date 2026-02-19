import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Check, X, AlertTriangle, RotateCcw, Shield, Clock, Camera, Monitor as MonitorIcon, Mic } from 'lucide-react';
import { type Violation, type CaptureLog, type AudioClip, QUESTIONS, QUIZ_DURATION, formatTime } from '@/lib/quiz-types';

interface ResultsPageProps {
  answers: Record<number, number>;
  violations: Violation[];
  captureLogs: CaptureLog[];
  audioClips: AudioClip[];
  timeSpent: number;
  onRetake: () => void;
}

export default function ResultsPage({ answers, violations, captureLogs, audioClips, timeSpent, onRetake }: ResultsPageProps) {
  const [modalImg, setModalImg] = useState<string | null>(null);

  const score = QUESTIONS.reduce((a, q) => a + (answers[q.id] === q.correct ? 1 : 0), 0);
  const pct = Math.round((score / QUESTIONS.length) * 100);
  const passed = pct >= 60;
  const webcamLogs = captureLogs.filter(l => l.kind === 'webcam');
  const screenLogs = captureLogs.filter(l => l.kind === 'screen');
  const criticalViolations = violations.filter(v => v.severity === 'error').length;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Score header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
              {/* Score ring */}
              <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                  <circle
                    cx="60" cy="60" r="52" fill="none"
                    stroke={passed ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
                    strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * 327} 327`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-foreground">{pct}%</span>
                  <span className="text-xs text-muted-foreground">{score}/{QUESTIONS.length}</span>
                </div>
              </div>

              {/* Details */}
              <div className="flex-1 space-y-3 text-center sm:text-left">
                <div className="flex items-center justify-center gap-2 sm:justify-start">
                  <h1 className="text-2xl font-bold text-foreground">Examination Complete</h1>
                  <Badge className={passed ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}>
                    {passed ? 'PASSED' : 'FAILED'}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground justify-center sm:justify-start">
                  <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {formatTime(timeSpent)} spent</span>
                  <span className="flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> {violations.length} violation{violations.length !== 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><Shield className="h-4 w-4" /> {criticalViolations} critical</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="answers">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="answers">Answers</TabsTrigger>
            <TabsTrigger value="integrity">Integrity ({violations.length})</TabsTrigger>
            <TabsTrigger value="captures">Captures ({captureLogs.length})</TabsTrigger>
            <TabsTrigger value="audio">Audio ({audioClips.length})</TabsTrigger>
          </TabsList>

          {/* Answers */}
          <TabsContent value="answers" className="space-y-3">
            {QUESTIONS.map(q => {
              const ua = answers[q.id];
              const ok = ua === q.correct;
              return (
                <Card key={q.id}>
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        ok ? 'bg-success/10 text-success' : ua !== undefined ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
                      }`}>
                        {ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{q.question}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Your answer: {ua !== undefined ? q.options[ua] : 'Not answered'}
                        </p>
                        {!ok && (
                          <p className="text-sm text-success mt-0.5">
                            Correct: {q.options[q.correct]}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          {/* Integrity */}
          <TabsContent value="integrity" className="space-y-3">
            {violations.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-8 justify-center">
                  <Check className="h-6 w-6 text-success" />
                  <p className="text-sm text-muted-foreground">No violations recorded. Clean session.</p>
                </CardContent>
              </Card>
            ) : violations.map(v => (
              <Card key={v.id}>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={v.severity === 'error' ? 'destructive' : 'secondary'}>
                        {v.severity}
                      </Badge>
                      <span className="text-sm font-medium text-foreground">{v.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{v.timestamp.toLocaleTimeString()}</span>
                  </div>
                  {v.detail && <p className="text-xs text-muted-foreground">{v.detail}</p>}
                  {v.awayMs && <p className="text-xs text-muted-foreground">Away for {(v.awayMs / 1000).toFixed(1)}s</p>}
                  {(v.webcamShot || v.screenShot) && (
                    <div className="flex gap-2">
                      {v.webcamShot && (
                        <button onClick={() => setModalImg(v.webcamShot!)} className="group relative overflow-hidden rounded-md border">
                          <img src={v.webcamShot} alt="Webcam capture" className="h-16 w-24 object-cover" />
                          <span className="absolute bottom-0 left-0 right-0 bg-foreground/70 text-background text-[10px] text-center py-0.5">Webcam</span>
                        </button>
                      )}
                      {v.screenShot && (
                        <button onClick={() => setModalImg(v.screenShot!)} className="group relative overflow-hidden rounded-md border">
                          <img src={v.screenShot} alt="Screen capture" className="h-16 w-24 object-cover" />
                          <span className="absolute bottom-0 left-0 right-0 bg-foreground/70 text-background text-[10px] text-center py-0.5">Screen</span>
                        </button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Captures */}
          <TabsContent value="captures">
            <Card>
              <CardContent className="pt-4">
                {captureLogs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No captures recorded.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {captureLogs.map(l => (
                      <button key={l.id} onClick={() => setModalImg(l.dataUrl)} className="group relative overflow-hidden rounded-md border aspect-video">
                        <img src={l.dataUrl} alt={`${l.kind} capture`} className="h-full w-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-foreground/70 text-background flex items-center justify-between px-1.5 py-0.5">
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-auto border-background/30 text-background">
                            {l.trigger}
                          </Badge>
                          <span className="text-[9px]">{l.timestamp.toLocaleTimeString()}</span>
                        </div>
                        <div className="absolute top-1 left-1">
                          {l.kind === 'webcam' ? <Camera className="h-3 w-3 text-background" /> : <MonitorIcon className="h-3 w-3 text-background" />}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audio */}
          <TabsContent value="audio" className="space-y-3">
            {audioClips.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-8 justify-center">
                  <Check className="h-6 w-6 text-success" />
                  <p className="text-sm text-muted-foreground">No audio violations recorded.</p>
                </CardContent>
              </Card>
            ) : audioClips.map((clip, i) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Audio Clip {i + 1}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{clip.timestamp.toLocaleTimeString()}</span>
                  </div>
                  <audio controls src={clip.dataUrl} className="w-full h-8" />
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex justify-center pb-8">
          <Button variant="outline" onClick={onRetake}>
            <RotateCcw className="mr-2 h-4 w-4" /> Retake Exam
          </Button>
        </div>
      </div>

      {/* Image modal */}
      <Dialog open={!!modalImg} onOpenChange={() => setModalImg(null)}>
        <DialogContent className="max-w-3xl p-2">
          {modalImg && <img src={modalImg} alt="Capture" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
