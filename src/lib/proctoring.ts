import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

// ─── MediaPipe FaceLandmarker singleton ──────────────────────────────────────

let mpLandmarker: FaceLandmarker | null = null;
let mpLoading = false;

export async function getLandmarker(): Promise<FaceLandmarker> {
  if (mpLandmarker) return mpLandmarker;
  if (mpLoading) { while (mpLoading) await new Promise(r => setTimeout(r, 100)); return mpLandmarker!; }
  mpLoading = true;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  mpLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
  mpLoading = false;
  return mpLandmarker;
}

export async function detectFaces(video: HTMLVideoElement): Promise<FaceLandmarkerResult | null> {
  if (video.readyState < 2 || video.paused || video.videoWidth === 0) return null;
  try {
    const d = await getLandmarker();
    return d.detectForVideo(video, performance.now());
  } catch { return null; }
}

// ─── Head pose from facial transformation matrix ─────────────────────────────

export function getHeadYaw(matrix: number[]): number {
  if (!matrix || matrix.length < 16) return 0;
  const yawRad = Math.atan2(-matrix[2], matrix[0]);
  return yawRad * (180 / Math.PI);
}

export function getHeadPitch(matrix: number[]): number {
  if (!matrix || matrix.length < 16) return 0;
  const pitchRad = Math.asin(Math.max(-1, Math.min(1, matrix[6])));
  return pitchRad * (180 / Math.PI);
}

// ─── Face embedding from landmarks ───────────────────────────────────────────

export function extractEmbeddingFromLandmarks(landmarks: { x: number; y: number; z: number }[]): number[] | null {
  if (!landmarks || landmarks.length < 468) return null;
  const KEY = [1, 10, 33, 61, 133, 152, 199, 234, 263, 291, 362, 454];
  const pts = KEY.map(i => landmarks[i]);
  const nose = pts[0];
  const raw = pts.flatMap(p => [p.x - nose.x, p.y - nose.y, p.z - nose.z]);
  const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) + 1e-8;
  return raw.map(v => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// ─── Stream snapshot helper ───────────────────────────────────────────────────

export async function snapStream(stream: MediaStream | null): Promise<string | undefined> {
  if (!stream) return undefined;
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return undefined;
    // Try ImageCapture for instant frame grab
    if ('ImageCapture' in window) {
      try {
        const ic = new (window as any).ImageCapture(track);
        const bmp = await ic.grabFrame();
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d')?.drawImage(bmp, 0, 0);
        return c.toDataURL('image/jpeg', 0.7);
      } catch { /* fall through */ }
    }
    const v = document.createElement('video');
    v.srcObject = new MediaStream([track]);
    v.muted = true;
    await v.play();
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    c.getContext('2d')?.drawImage(v, 0, 0);
    v.pause();
    v.srcObject = null;
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return undefined; }
}

// ─── Multiple monitor detection ──────────────────────────────────────────────

export function detectMultipleMonitors(): { detected: boolean; reason: string } {
  const scr = window.screen as any;
  if (scr.isExtended === true) {
    return { detected: true, reason: 'Multiple monitors detected' };
  }
  if (scr.availWidth > scr.width) {
    return { detected: true, reason: 'Extended display detected' };
  }
  return { detected: false, reason: '' };
}
