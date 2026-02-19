import { FaceDetector, FilesetResolver, type FaceDetectorResult } from '@mediapipe/tasks-vision';

// ─── MediaPipe singleton ──────────────────────────────────────────────────────

let mpDetector: FaceDetector | null = null;
let mpLoading = false;

export async function getDetector(): Promise<FaceDetector> {
  if (mpDetector) return mpDetector;
  if (mpLoading) {
    while (mpLoading) await new Promise(r => setTimeout(r, 100));
    return mpDetector!;
  }
  mpLoading = true;
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );
  mpDetector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.3,
  });
  mpLoading = false;
  return mpDetector;
}

export async function detectFaces(video: HTMLVideoElement): Promise<FaceDetectorResult | null> {
  if (video.readyState < 2 || video.paused || video.videoWidth === 0) return null;
  try {
    const d = await getDetector();
    return d.detectForVideo(video, performance.now());
  } catch {
    return null;
  }
}

// ─── Face embedding via canvas histogram ──────────────────────────────────────

export function extractEmbedding(
  video: HTMLVideoElement,
  box: { originX: number; originY: number; width: number; height: number }
): number[] | null {
  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, box.originX, box.originY, box.width, box.height, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const hist = new Array(96).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      hist[Math.floor(data[i] / 8)] += 1;
      hist[Math.floor(data[i + 1] / 8) + 32] += 1;
      hist[Math.floor(data[i + 2] / 8) + 64] += 1;
    }
    const total = 64 * 64;
    return hist.map(v => v / total);
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// ─── Stream snapshot helper ───────────────────────────────────────────────────

export async function snapStream(stream: MediaStream | null): Promise<string | undefined> {
  if (!stream) return undefined;
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') return undefined;
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
  } catch {
    return undefined;
  }
}
