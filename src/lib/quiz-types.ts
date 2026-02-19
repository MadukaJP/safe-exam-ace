export type ViolationType =
  | 'TAB_SWITCH' | 'WINDOW_BLUR' | 'NO_FACE' | 'MULTIPLE_FACES'
  | 'IDENTITY_MISMATCH' | 'FULLSCREEN_EXIT' | 'COPY_ATTEMPT'
  | 'DEVTOOLS_OPEN' | 'CONTEXT_MENU' | 'SCREEN_SHARE_STOPPED'
  | 'AUDIO_DETECTED' | 'MULTIPLE_MONITORS' | 'KEYBOARD_SHORTCUT';

export interface Violation {
  id: string;
  type: ViolationType;
  label: string;
  severity: 'warn' | 'error';
  timestamp: Date;
  webcamShot?: string;
  screenShot?: string;
  awayMs?: number;
  detail?: string;
}

export interface CaptureLog {
  id: string;
  timestamp: Date;
  kind: 'webcam' | 'screen';
  dataUrl: string;
  trigger: 'periodic' | 'violation' | 'fullscreen_exit';
}

export interface AudioClip {
  timestamp: Date;
  dataUrl: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: number;
}

export type QuizPhase = 'WELCOME' | 'SETUP' | 'ACTIVE' | 'RESULTS';

export const QUESTIONS: QuizQuestion[] = [
  { id: 1, question: 'What does HTTP stand for?', options: ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'HyperText Transmission Process', 'Hyper Transfer Text Processing'], correct: 0 },
  { id: 2, question: 'Which data structure uses LIFO ordering?', options: ['Queue', 'Stack', 'Linked List', 'Tree'], correct: 1 },
  { id: 3, question: 'What is the time complexity of binary search?', options: ['O(n)', 'O(n²)', 'O(log n)', 'O(1)'], correct: 2 },
  { id: 4, question: 'Which hook is used for side effects in React?', options: ['useState', 'useRef', 'useCallback', 'useEffect'], correct: 3 },
  { id: 5, question: 'What does CSS stand for?', options: ['Creative Style Sheets', 'Cascading Style Sheets', 'Computer Style Syntax', 'Coded Style Structures'], correct: 1 },
];

export const QUIZ_DURATION = 300; // 5 minutes

export const VIOLATION_CONFIG: Record<ViolationType, { label: string; severity: 'warn' | 'error' }> = {
  TAB_SWITCH:           { label: 'Tab Switch Detected',       severity: 'error' },
  WINDOW_BLUR:          { label: 'Window Lost Focus',          severity: 'warn'  },
  NO_FACE:              { label: 'No Face Detected',           severity: 'error' },
  MULTIPLE_FACES:       { label: 'Multiple Faces Detected',    severity: 'error' },
  IDENTITY_MISMATCH:    { label: 'Identity Mismatch',          severity: 'error' },
  FULLSCREEN_EXIT:      { label: 'Fullscreen Exited',          severity: 'error' },
  COPY_ATTEMPT:         { label: 'Copy/Paste Attempt',         severity: 'warn'  },
  DEVTOOLS_OPEN:        { label: 'DevTools Detected',          severity: 'error' },
  CONTEXT_MENU:         { label: 'Right-Click Attempt',        severity: 'warn'  },
  SCREEN_SHARE_STOPPED: { label: 'Screen Share Stopped',       severity: 'error' },
  AUDIO_DETECTED:       { label: 'Audio/Voice Detected',       severity: 'warn'  },
  MULTIPLE_MONITORS:    { label: 'Multiple Monitors Detected', severity: 'warn'  },
  KEYBOARD_SHORTCUT:    { label: 'Blocked Keyboard Shortcut',  severity: 'warn'  },
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const formatTime = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
