import { Shield, Clock, HelpCircle, Award, Camera, Mic, Wifi, Monitor } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface WelcomePageProps {
  onStart: () => void;
}

const requirements = [
  { icon: Camera, label: 'Working webcam' },
  { icon: Mic, label: 'Working microphone' },
  { icon: Wifi, label: 'Stable internet connection' },
  { icon: Monitor, label: 'Quiet, well-lit room' },
];

export default function WelcomePage({ onStart }: WelcomePageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Proctored Assessment
          </h1>
          <p className="text-muted-foreground">
            Complete your exam in a secure, monitored environment
          </p>
        </div>

        {/* Exam details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">CS101 — Midterm Examination</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3">
                <HelpCircle className="h-5 w-5 text-muted-foreground" />
                <span className="text-xl font-semibold text-foreground">5</span>
                <span className="text-xs text-muted-foreground">Questions</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span className="text-xl font-semibold text-foreground">5:00</span>
                <span className="text-xs text-muted-foreground">Minutes</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3">
                <Award className="h-5 w-5 text-muted-foreground" />
                <span className="text-xl font-semibold text-foreground">60%</span>
                <span className="text-xs text-muted-foreground">Pass Score</span>
              </div>
              <div className="flex flex-col items-center gap-1 rounded-lg bg-muted p-3">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <span className="text-xl font-semibold text-foreground">Full</span>
                <span className="text-xs text-muted-foreground">Proctoring</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Requirements */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Before You Begin</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Make sure you have the following ready:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {requirements.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Proctoring notice */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 shrink-0 text-primary mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">This exam is proctored</p>
              <p className="text-xs text-muted-foreground">
                Your webcam, microphone, and screen will be monitored throughout the exam. 
                Tab switching, face detection, and audio activity are tracked to maintain integrity.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <Button size="lg" onClick={onStart} className="px-8">
            Start Environment Setup
          </Button>
        </div>
      </div>
    </div>
  );
}
