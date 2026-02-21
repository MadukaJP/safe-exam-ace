export type ViolationType =
  | 'TAB_SWITCH' | 'WINDOW_BLUR' | 'NO_FACE' | 'MULTIPLE_FACES'
  | 'IDENTITY_MISMATCH' | 'FULLSCREEN_EXIT' | 'COPY_ATTEMPT'
  | 'DEVTOOLS_OPEN' | 'CONTEXT_MENU' | 'SCREEN_SHARE_STOPPED'
  | 'NOISE_DETECTED' | 'AUDIO_DETECTED' | 'MULTIPLE_MONITORS'
  | 'KEYBOARD_SHORTCUT' | 'GAZE_AWAY';

export interface Violation {
  id: string;
  type: ViolationType;
  label: string;
  severity: 'warn' | 'error';
  timestamp: Date;
  webcamShot?: string;
  screenShot?: string;
  audioUrl?: string;
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
  TAB_SWITCH:           { label: 'Left the Exam Window',        severity: 'error' },
  WINDOW_BLUR:          { label: 'Window Lost Focus',            severity: 'warn'  },
  NO_FACE:              { label: 'Face Not Visible',             severity: 'error' },
  MULTIPLE_FACES:       { label: 'Another Person Detected',      severity: 'error' },
  IDENTITY_MISMATCH:    { label: 'Identity Could Not Be Verified', severity: 'error' },
  FULLSCREEN_EXIT:      { label: 'Left Fullscreen Mode',         severity: 'error' },
  COPY_ATTEMPT:         { label: 'Copy/Paste Not Allowed',       severity: 'warn'  },
  DEVTOOLS_OPEN:        { label: 'Developer Tools Detected',     severity: 'error' },
  CONTEXT_MENU:         { label: 'Right-Click Not Allowed',      severity: 'warn'  },
  SCREEN_SHARE_STOPPED: { label: 'Screen Sharing Ended',         severity: 'error' },
  NOISE_DETECTED:       { label: 'Background Noise Detected',    severity: 'warn'  },
  AUDIO_DETECTED:       { label: 'Voice/Speech Detected',        severity: 'error' },
  MULTIPLE_MONITORS:    { label: 'Multiple Displays Detected',   severity: 'error' },
  KEYBOARD_SHORTCUT:    { label: 'Blocked Shortcut Used',        severity: 'warn'  },
  GAZE_AWAY:            { label: 'Looking Away from Screen',     severity: 'error' },
};

// Human-readable toast messages shown to the student
export const VIOLATION_TOAST: Record<ViolationType, string> = {
  TAB_SWITCH:           'Please stay on the exam window.',
  WINDOW_BLUR:          'Please stay focused on the exam.',
  NO_FACE:              'Please keep your face visible in the camera.',
  MULTIPLE_FACES:       'Only you may be present during the exam.',
  IDENTITY_MISMATCH:    'Your identity could not be verified.',
  FULLSCREEN_EXIT:      'Please return to fullscreen mode.',
  COPY_ATTEMPT:         'Copy and paste is not allowed.',
  DEVTOOLS_OPEN:        'Developer tools are not allowed.',
  CONTEXT_MENU:         'Right-clicking is not allowed.',
  SCREEN_SHARE_STOPPED: 'Screen sharing has ended. Please resume.',
  NOISE_DETECTED:       'Background noise detected.',
  AUDIO_DETECTED:       'Voice activity detected.',
  MULTIPLE_MONITORS:    'Please disconnect extra monitors.',
  KEYBOARD_SHORTCUT:    'That keyboard shortcut is blocked.',
  GAZE_AWAY:            'Please keep your eyes on the screen.',
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const formatTime = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
