

# Proctored Quiz App — Reimagined

## Overview
A polished, modern proctored examination platform inspired by tools like ExamSoft, ProctorU, and HackerRank's proctored assessments. Uses the provided code as a technical guide for proctoring logic (MediaPipe face detection, audio monitoring, screen capture, violation tracking) but with a completely original UI/UX design built with shadcn/ui components and Tailwind.

---

## Flow & Pages

### Page 1 — Welcome / Landing
A clean landing card centered on screen with:
- App logo/icon and "Proctored Assessment" title
- Exam details card: subject, duration, number of questions, passing score
- A checklist of what the student needs (webcam, mic, stable internet, quiet room)
- "Start Setup" button leading to the wizard
- Calm, professional tone — not intimidating

### Page 2 — Environment Setup Wizard
A full-page wizard with a horizontal stepper/progress bar at the top showing 4 steps:

**Step 1 — System Compatibility**
- Auto-checks: browser support, screen resolution, webcam available, mic available
- Each check shows a loading spinner → green checkmark or red X
- All checks must pass to proceed (with troubleshooting tips on failure)

**Step 2 — Microphone Check**
- Requests mic permission
- Shows a real-time waveform/level bar — "Say something to test your mic"
- Once audio input is detected above threshold for 2+ seconds, shows green confirmation
- Option to select different mic if multiple are available
- "Next" unlocks after successful audio detection

**Step 3 — Camera & Identity**
- Requests webcam permission, shows mirrored live preview in a rounded card
- Oval face guide overlay (like passport photo guides) to help positioning
- MediaPipe face detection runs continuously
- Status messages: "Position your face in the frame" → "Hold still..." → "✓ Identity captured"
- Captures reference embedding for identity verification during exam
- Must hold steady detection for ~3 seconds before proceeding

**Step 4 — Screen Share & Final Confirmation**
- Summary of exam rules in a clean card with icons:
  - Tab switching is monitored
  - Face must remain visible
  - Audio is recorded on detection
  - Fullscreen is required
  - No copy/paste or dev tools
- Agreement checkbox: "I understand and agree to the proctoring terms"
- "Share Screen & Begin" button — prompts for entire screen share, validates it's full monitor, then enters fullscreen and starts exam

### Page 3 — Active Examination
Clean, distraction-free quiz interface:

**Fixed Top Header Bar**
- Left: Exam name, question progress (e.g., "3 of 5")
- Center: Large countdown timer (mm:ss) — pulses red when < 60s
- Right: Status indicators as small pills/badges — Face ✓, Screen ✓, Mic ✓ (turn red/yellow on issues)

**Main Content Area**
- Large question card with question number badge
- Answer options as radio-style cards with hover effects and selection animations
- Clear visual distinction between selected and unselected options

**Bottom Navigation**
- Left: "Previous" button
- Center: Question navigation dots (filled = answered, outlined = unanswered, ring = current)
- Right: "Next" or "Submit Exam" (on last question, with confirmation dialog)

**Proctoring Sidebar (collapsible, right edge)**
- Tiny webcam preview thumbnail
- Audio level micro-bar
- Violation count badge (click to see recent violations in a popover)

**Background Proctoring (invisible to student):**
- All the logic from the provided code: tab switch detection, visibility API, face detection loop every ~1.5s, identity cosine similarity check, audio frequency analysis with voice detection and clip recording, fullscreen enforcement with blocking overlay, keyboard shortcut interception, copy/paste/context menu blocking, DevTools size heuristic, multiple monitor detection, periodic screenshot capture every 15s

**Fullscreen Recovery Overlay**
- If student exits fullscreen, a modal overlay blocks the quiz
- Clear message explaining the violation was recorded
- Single button to re-enter fullscreen

### Page 4 — Results & Proctoring Report
A comprehensive post-exam report:

**Score Section**
- Large circular progress ring showing percentage
- Pass/Fail badge with color coding (green/red)
- Score breakdown: "X of Y correct"

**Tabbed Report Sections** (using shadcn Tabs):

- **Answer Review** — Each question listed with the student's answer, correct answer, and ✓/✗ indicator. Clean accordion or card layout.
- **Integrity Report** — Timeline of violations with severity badges (warning/critical), timestamps, and expandable details. Webcam/screen thumbnails clickable to view full-size in a dialog.
- **Capture Gallery** — Grid of periodic webcam and screen captures with timestamps and trigger labels (periodic/violation/fullscreen exit). Click to enlarge.
- **Audio Evidence** — List of recorded audio clips with timestamps and inline audio players.

**Footer**
- "Retake Exam" button
- Session summary: duration, total violations, integrity score

---

## Design Approach
- Built entirely with shadcn/ui components (Card, Button, Badge, Tabs, Dialog, Progress, etc.) and Tailwind
- Clean white/light background with subtle gray cards — professional SaaS aesthetic
- Indigo/blue as primary accent color
- Smooth step transitions in the wizard
- Responsive but optimized for desktop (proctored exams are desktop-only in practice)
- Toast notifications (sonner) for violation alerts during the exam

## Technical Approach
- MediaPipe Tasks Vision loaded from CDN for face detection (as in the guide code)
- Canvas histogram-based face embedding for lightweight identity verification
- Web Audio API with frequency analysis for voice detection
- MediaRecorder API for audio clip capture
- getDisplayMedia for screen sharing with surface validation
- Fullscreen API with change event monitoring
- All state in React (useState/useRef) — no backend, no persistence
- 5 hardcoded quiz questions, 5-minute timer

