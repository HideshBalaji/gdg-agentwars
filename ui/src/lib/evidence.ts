/**
 * Evidence intake for the composer: attach files, record a voice note, or load the
 * data team's sample breakdown photo + voice note. In live mode each file is uploaded
 * to POST /api/uploads straight away; its backend ID is attached to the next incident
 * or chat message.
 */
import type { Evidence } from './contract';
import { uid } from './format';
import { toast, useStore, type PendingEvidence } from './store';

const TOKEN = import.meta.env.VITE_API_TOKEN || 'ghost-demo';
const BASE = import.meta.env.VITE_API_URL || '';

/** MIME types the backend accepts (ghost_dispatcher/api.py). */
const ACCEPTED = ['image/jpeg', 'image/png', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'application/pdf'];
export const ACCEPT_ATTR = 'image/jpeg,image/png,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

/** Browsers report some audio types differently from what the backend allow-lists. */
function normaliseMime(file: File) {
  const t = (file.type || '').split(';')[0];
  if (t === 'audio/x-wav' || t === 'audio/wave') return 'audio/wav';
  if (t === 'audio/x-m4a' || t === 'audio/m4a') return 'audio/mp4';
  if (!t && /\.wav$/i.test(file.name)) return 'audio/wav';
  if (!t && /\.m4a$/i.test(file.name)) return 'audio/mp4';
  return t;
}

const kindOf = (mime: string): Evidence['kind'] =>
  mime.startsWith('image/') ? 'photo' : mime.startsWith('audio/') ? 'voice' : 'pdf';

function patch(id: string, change: Partial<PendingEvidence>) {
  useStore.setState((s) => ({
    pendingEvidence: s.pendingEvidence.map((e) => (e.id === id ? { ...e, ...change } : e)),
  }));
}

async function upload(item: PendingEvidence, file: File) {
  const form = new FormData();
  form.append('file', new File([file], file.name, { type: item.mime }));
  try {
    const res = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
    patch(item.id, { status: 'ready', backend_id: body.id });
  } catch (e) {
    patch(item.id, { status: 'error', error: (e as Error).message });
    toast({ tone: 'bad', title: `Upload failed: ${file.name}`, body: (e as Error).message });
  }
}

export function addFiles(files: File[], extra: Partial<Evidence>[] = []) {
  const live = useStore.getState().mode === 'live';
  files.forEach((file, i) => {
    const mime = normaliseMime(file);
    if (!ACCEPTED.includes(mime)) {
      toast({ tone: 'bad', title: `Unsupported file: ${file.name}`, body: 'Use JPEG, PNG, WAV, MP3, M4A, WebM audio or PDF' });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ tone: 'bad', title: `${file.name} is too large`, body: 'Maximum 10 MiB per file' });
      return;
    }
    const item: PendingEvidence = {
      id: uid('ev'),
      kind: kindOf(mime),
      name: file.name,
      url: URL.createObjectURL(file),
      mime,
      size: file.size,
      status: live ? 'uploading' : 'ready',
      ...extra[i],
    };
    useStore.setState((s) => ({ pendingEvidence: [...s.pendingEvidence, item] }));
    if (live) upload(item, file);
  });
}

export function removePending(id: string) {
  useStore.setState((s) => ({ pendingEvidence: s.pendingEvidence.filter((e) => e.id !== id) }));
}

/** Removes and returns the evidence that is ready to attach. */
export function takeReady(): PendingEvidence[] {
  const ready = useStore.getState().pendingEvidence.filter((e) => e.status === 'ready');
  useStore.setState((s) => ({ pendingEvidence: s.pendingEvidence.filter((e) => e.status !== 'ready') }));
  return ready;
}

export const uploading = () => useStore.getState().pendingEvidence.some((e) => e.status === 'uploading');

/** The data team's breakdown evidence (data/photos, data/audio), served by the Vite dev server. */
export async function addSamples() {
  try {
    const [photo, voice, transcript] = await Promise.all([
      fetch('/samples/reefer_truck.jpg').then((r) => (r.ok ? r.blob() : Promise.reject(new Error('photo')))),
      fetch('/samples/breakdown.wav').then((r) => (r.ok ? r.blob() : Promise.reject(new Error('voice')))),
      fetch('/samples/breakdown.txt').then((r) => (r.ok ? r.text() : '')),
    ]);
    addFiles(
      [
        new File([photo], 'reefer_truck.jpg', { type: 'image/jpeg' }),
        new File([voice], 'breakdown.wav', { type: 'audio/wav' }),
      ],
      [
        { caption: 'Illustrative photo: Windmemories, CC BY-SA 4.0 (Wikimedia Commons). Not TN-07.' },
        { transcript: transcript.trim(), caption: 'Synthetic driver voice note (data/audio/breakdown.wav)', synthetic: true },
      ],
    );
  } catch {
    toast({ tone: 'bad', title: 'Samples unavailable', body: 'Run the UI with make ui so /samples is served from data/' });
  }
}

let recorder: MediaRecorder | null = null;

export async function toggleRecording() {
  if (recorder) {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      useStore.setState({ recording: false });
      const blob = new Blob(chunks, { type: 'audio/webm' });
      if (blob.size) addFiles([new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' })]);
    };
    recorder.start();
    useStore.setState({ recording: true });
  } catch (e) {
    recorder = null;
    useStore.setState({ recording: false });
    toast({ tone: 'bad', title: 'Microphone unavailable', body: (e as Error).message });
  }
}

export const fmtBytes = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
