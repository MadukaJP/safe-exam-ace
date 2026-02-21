import { useState, useCallback } from 'react';
import { type QuizPhase, type Violation, type CaptureLog, type AudioClip } from '@/lib/quiz-types';
import WelcomePage from '@/components/quiz/WelcomePage';
import SetupWizard from '@/components/quiz/SetupWizard';
import ActiveQuiz from '@/components/quiz/ActiveQuiz';
import ResultsPage from '@/components/quiz/ResultsPage';

interface ExamStreams {
  webcamStream: MediaStream;
  micStream: MediaStream;
  screenStream: MediaStream;
  referenceEmbedding: number[] | null;
  proctorEnabled: boolean;
}

interface ExamResults {
  answers: Record<number, number>;
  violations: Violation[];
  captureLogs: CaptureLog[];
  audioClips: AudioClip[];
  timeSpent: number;
}

export default function Index() {
  const [phase, setPhase] = useState<QuizPhase>('WELCOME');
  const [streams, setStreams] = useState<ExamStreams | null>(null);
  const [results, setResults] = useState<ExamResults | null>(null);

  const handleSetupComplete = useCallback((data: ExamStreams) => {
    setStreams(data);
    setPhase('ACTIVE');
  }, []);

  const handleFinish = useCallback((data: ExamResults) => {
    setResults(data);
    setPhase('RESULTS');
  }, []);

  const handleRetake = useCallback(() => {
    setStreams(null);
    setResults(null);
    setPhase('WELCOME');
  }, []);

  if (phase === 'WELCOME') {
    return <WelcomePage onStart={() => setPhase('SETUP')} />;
  }

  if (phase === 'SETUP') {
    return <SetupWizard onComplete={handleSetupComplete} onBack={() => setPhase('WELCOME')} />;
  }

  if (phase === 'ACTIVE' && streams) {
    return (
      <ActiveQuiz
        webcamStream={streams.webcamStream}
        micStream={streams.micStream}
        screenStream={streams.screenStream}
        referenceEmbedding={streams.referenceEmbedding}
        proctorEnabled={streams.proctorEnabled}
        onFinish={handleFinish}
      />
    );
  }

  if (phase === 'RESULTS' && results) {
    return (
      <ResultsPage
        answers={results.answers}
        violations={results.violations}
        captureLogs={results.captureLogs}
        audioClips={results.audioClips}
        timeSpent={results.timeSpent}
        onRetake={handleRetake}
      />
    );
  }

  return null;
}
