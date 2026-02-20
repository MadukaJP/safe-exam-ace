import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { type Violation, type CaptureLog, type AudioClip, QUESTIONS, QUIZ_DURATION } from '@/lib/quiz-types';
import ProctorWrapper from './ProctorWrapper';

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
  const [currentQ, setCurrentQ] = useState(0);

  const handleProctorFinish = useCallback((data: { violations: Violation[]; captureLogs: CaptureLog[]; audioClips: AudioClip[]; timeSpent: number }) => {
    onFinish({ answers, ...data });
  }, [answers, onFinish]);

  const q = QUESTIONS[currentQ];

  return (
    <ProctorWrapper
      webcamStream={webcamStream}
      micStream={micStream}
      screenStream={screenStream}
      referenceEmbedding={referenceEmbedding}
      durationSeconds={QUIZ_DURATION}
      examTitle="CS101 Midterm"
      onTimeUp={handleProctorFinish}
      onManualSubmit={handleProctorFinish}
    >
      {({ requestSubmit }) => (
        <div className="flex flex-1 flex-col">
          <main className="flex flex-1 items-center justify-center px-4 py-8">
            <div className="w-full max-w-2xl space-y-6">
              <Card>
                <CardContent className="pt-6 space-y-6">
                  <div className="space-y-2">
                    <Badge variant="secondary" className="mb-2">Question {currentQ + 1} of {QUESTIONS.length}</Badge>
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
                <Button onClick={requestSubmit} className="bg-success hover:bg-success/90 text-success-foreground">
                  <Send className="mr-1 h-4 w-4" /> Submit
                </Button>
              )}
            </div>
          </footer>
        </div>
      )}
    </ProctorWrapper>
  );
}
