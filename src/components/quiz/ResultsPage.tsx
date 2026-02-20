import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, AlertTriangle, RotateCcw, Shield, Clock, Camera, Monitor as MonitorIcon, Mic, Download, FileText } from 'lucide-react';
import { type Violation, type CaptureLog, type AudioClip, type ViolationType, QUESTIONS, VIOLATION_CONFIG, formatTime } from '@/lib/quiz-types';
import { jsPDF } from 'jspdf';

interface ResultsPageProps {
  answers: Record<number, number>;
  violations: Violation[];
  captureLogs: CaptureLog[];
  audioClips: AudioClip[];
  timeSpent: number;
  onRetake: () => void;
}

const ALL_VIOLATION_TYPES = Object.keys(VIOLATION_CONFIG) as ViolationType[];

// Merge captures and violations into a unified log timeline
interface LogEntry {
  id: string;
  timestamp: Date;
  kind: 'violation' | 'capture';
  violation?: Violation;
  capture?: CaptureLog;
}

function buildTimeline(violations: Violation[], captures: CaptureLog[]): LogEntry[] {
  const entries: LogEntry[] = [];
  violations.forEach(v => entries.push({ id: v.id, timestamp: v.timestamp, kind: 'violation', violation: v }));
  // Only add periodic captures (violation captures are already shown with their violation)
  captures
    .filter(c => c.trigger === 'periodic')
    .forEach(c => entries.push({ id: c.id, timestamp: c.timestamp, kind: 'capture', capture: c }));
  entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return entries;
}

function generateTextReport(
  answers: Record<number, number>,
  violations: Violation[],
  audioClips: AudioClip[],
  timeSpent: number,
  score: number,
  pct: number,
  passed: boolean
): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push('       PROCTORED EXAMINATION REPORT       ');
  lines.push('═══════════════════════════════════════════');
  lines.push('');
  lines.push(`Date: ${new Date().toLocaleString()}`);
  lines.push(`Duration: ${formatTime(timeSpent)}`);
  lines.push(`Score: ${score}/${QUESTIONS.length} (${pct}%)`);
  lines.push(`Result: ${passed ? 'PASSED' : 'FAILED'}`);
  lines.push(`Total Violations: ${violations.length}`);
  lines.push(`Critical Violations: ${violations.filter(v => v.severity === 'error').length}`);
  lines.push(`Audio Clips Recorded: ${audioClips.length}`);
  lines.push('');
  lines.push('───────────────────────────────────────────');
  lines.push('ANSWER REVIEW');
  lines.push('───────────────────────────────────────────');
  QUESTIONS.forEach(q => {
    const ua = answers[q.id];
    const ok = ua === q.correct;
    lines.push(`Q${q.id}: ${q.question}`);
    lines.push(`  Your answer: ${ua !== undefined ? q.options[ua] : 'Not answered'} ${ok ? '✓' : '✗'}`);
    if (!ok) lines.push(`  Correct: ${q.options[q.correct]}`);
    lines.push('');
  });
  if (violations.length > 0) {
    lines.push('───────────────────────────────────────────');
    lines.push('INTEGRITY VIOLATIONS');
    lines.push('───────────────────────────────────────────');
    violations.forEach(v => {
      lines.push(`[${v.severity.toUpperCase()}] ${v.label} — ${v.timestamp.toLocaleTimeString()}`);
      if (v.detail) lines.push(`  Detail: ${v.detail}`);
      if (v.awayMs) lines.push(`  Away: ${(v.awayMs / 1000).toFixed(1)}s`);
    });
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════');
  lines.push('         END OF REPORT                    ');
  lines.push('═══════════════════════════════════════════');
  return lines.join('\n');
}

async function generatePdfReport(
  violations: Violation[],
  captureLogs: CaptureLog[],
  audioClips: AudioClip[],
  timeSpent: number,
  score: number,
  pct: number,
  passed: boolean
) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 15;
  let y = 20;

  const checkPage = (needed: number) => {
    if (y + needed > 275) { pdf.addPage(); y = 20; }
  };

  // Title
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Proctored Examination Report', pageW / 2, y, { align: 'center' });
  y += 10;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Generated: ${new Date().toLocaleString()}`, pageW / 2, y, { align: 'center' });
  y += 12;

  // Summary box
  pdf.setDrawColor(200);
  pdf.setFillColor(248, 249, 250);
  pdf.roundedRect(margin, y, pageW - margin * 2, 28, 3, 3, 'FD');

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  const resultColor = passed ? [34, 139, 34] : [220, 38, 38];
  pdf.setTextColor(...(resultColor as [number, number, number]));
  pdf.text(passed ? 'PASSED' : 'FAILED', margin + 8, y + 8);
  pdf.setTextColor(0);

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Score: ${score}/${QUESTIONS.length} (${pct}%)`, margin + 8, y + 15);
  pdf.text(`Duration: ${formatTime(timeSpent)}`, margin + 70, y + 15);
  pdf.text(`Violations: ${violations.length}`, margin + 8, y + 22);
  pdf.text(`Critical: ${violations.filter(v => v.severity === 'error').length}`, margin + 70, y + 22);
  pdf.text(`Audio Clips: ${audioClips.length}`, margin + 130, y + 22);
  y += 36;

  // Integrity Log
  if (violations.length > 0) {
    checkPage(20);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Integrity Log', margin, y);
    y += 8;

    for (const v of violations) {
      const imgH = (v.webcamShot || v.screenShot) ? 30 : 0;
      checkPage(18 + imgH);

      // Severity badge
      const sevColor: [number, number, number] = v.severity === 'error' ? [220, 38, 38] : [234, 179, 8];
      pdf.setFillColor(...sevColor);
      pdf.roundedRect(margin, y - 3, 16, 5, 1, 1, 'F');
      pdf.setFontSize(7);
      pdf.setTextColor(255);
      pdf.text(v.severity.toUpperCase(), margin + 1, y);
      pdf.setTextColor(0);

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(v.label, margin + 20, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text(v.timestamp.toLocaleTimeString(), pageW - margin, y, { align: 'right' });
      pdf.setTextColor(0);
      y += 5;

      if (v.detail) {
        pdf.setFontSize(8);
        pdf.text(v.detail, margin + 20, y);
        y += 4;
      }
      if (v.awayMs) {
        pdf.setFontSize(8);
        pdf.text(`Away for ${(v.awayMs / 1000).toFixed(1)}s`, margin + 20, y);
        y += 4;
      }

      // Inline images
      const imgs: { label: string; src: string }[] = [];
      if (v.webcamShot) imgs.push({ label: 'Webcam', src: v.webcamShot });
      if (v.screenShot) imgs.push({ label: 'Screen', src: v.screenShot });
      if (imgs.length > 0) {
        let imgX = margin + 20;
        for (const img of imgs) {
          try {
            pdf.addImage(img.src, 'JPEG', imgX, y, 40, 25);
            pdf.setFontSize(6);
            pdf.text(img.label, imgX, y + 27);
            imgX += 46;
          } catch { }
        }
        y += 30;
      }
      y += 4;
    }
  }

  // Periodic captures section
  const periodicCaptures = captureLogs.filter(c => c.trigger === 'periodic');
  if (periodicCaptures.length > 0) {
    checkPage(20);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Periodic Captures', margin, y);
    y += 8;

    let col = 0;
    for (const cap of periodicCaptures) {
      if (col === 0) checkPage(35);
      try {
        const imgX = margin + col * 48;
        pdf.addImage(cap.dataUrl, 'JPEG', imgX, y, 44, 28);
        pdf.setFontSize(6);
        pdf.setTextColor(100);
        pdf.text(`${cap.kind} — ${cap.timestamp.toLocaleTimeString()}`, imgX, y + 30);
        pdf.setTextColor(0);
      } catch { }
      col++;
      if (col >= 3) { col = 0; y += 35; }
    }
    if (col > 0) y += 35;
  }

  pdf.save(`exam-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export default function ResultsPage({ answers, violations, captureLogs, audioClips, timeSpent, onRetake }: ResultsPageProps) {
  const [modalImg, setModalImg] = useState<string | null>(null);
  const [violationFilter, setViolationFilter] = useState<string>('all');

  const score = QUESTIONS.reduce((a, q) => a + (answers[q.id] === q.correct ? 1 : 0), 0);
  const pct = Math.round((score / QUESTIONS.length) * 100);
  const passed = pct >= 60;
  const criticalViolations = violations.filter(v => v.severity === 'error').length;

  const presentTypes = useMemo(() => {
    const types = new Set(violations.map(v => v.type));
    return ALL_VIOLATION_TYPES.filter(t => types.has(t));
  }, [violations]);

  const timeline = useMemo(() => buildTimeline(violations, captureLogs), [violations, captureLogs]);

  const filteredTimeline = useMemo(() => {
    if (violationFilter === 'all') return timeline;
    return timeline.filter(e => {
      if (e.kind === 'violation' && e.violation) return e.violation.type === violationFilter;
      return false; // hide captures when filtering by type
    });
  }, [timeline, violationFilter]);

  const handleTextDownload = () => {
    const report = generateTextReport(answers, violations, audioClips, timeSpent, score, pct, passed);
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePdfDownload = () => {
    generatePdfReport(violations, captureLogs, audioClips, timeSpent, score, pct, passed);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Score header */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
              <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                  <circle cx="60" cy="60" r="52" fill="none"
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <TabsList className="justify-start">
              <TabsTrigger value="answers">Answers</TabsTrigger>
              <TabsTrigger value="logs">Logs ({timeline.length})</TabsTrigger>
              <TabsTrigger value="audio">Audio ({audioClips.length})</TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleTextDownload} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> TXT
              </Button>
              <Button variant="outline" size="sm" onClick={handlePdfDownload} className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> PDF
              </Button>
            </div>
          </div>

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
                          <p className="text-sm text-success mt-0.5">Correct: {q.options[q.correct]}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          {/* Unified Logs (violations + periodic captures) */}
          <TabsContent value="logs" className="space-y-3">
            {timeline.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Filter:</span>
                <Select value={violationFilter} onValueChange={setViolationFilter}>
                  <SelectTrigger className="w-56 h-8 text-xs">
                    <SelectValue placeholder="All events" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All events ({timeline.length})</SelectItem>
                    {presentTypes.map(t => (
                      <SelectItem key={t} value={t}>
                        {VIOLATION_CONFIG[t].label} ({violations.filter(v => v.type === t).length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filteredTimeline.length === 0 ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-8 justify-center">
                  <Check className="h-6 w-6 text-success" />
                  <p className="text-sm text-muted-foreground">
                    {timeline.length === 0 ? 'No events recorded. Clean session.' : 'No events match this filter.'}
                  </p>
                </CardContent>
              </Card>
            ) : filteredTimeline.map(entry => {
              if (entry.kind === 'violation' && entry.violation) {
                const v = entry.violation;
                return (
                  <Card key={v.id}>
                    <CardContent className="pt-4 pb-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant={v.severity === 'error' ? 'destructive' : 'secondary'}>{v.severity}</Badge>
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
                );
              }
              if (entry.kind === 'capture' && entry.capture) {
                const c = entry.capture;
                return (
                  <Card key={c.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {c.kind === 'webcam' ? <Camera className="mr-1 h-3 w-3" /> : <MonitorIcon className="mr-1 h-3 w-3" />}
                            {c.trigger} capture
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{c.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <button onClick={() => setModalImg(c.dataUrl)} className="relative overflow-hidden rounded-md border">
                        <img src={c.dataUrl} alt={`${c.kind} capture`} className="h-20 w-32 object-cover" />
                      </button>
                    </CardContent>
                  </Card>
                );
              }
              return null;
            })}
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
