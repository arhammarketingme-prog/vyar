// Reels are capped at 60 seconds. A longer upload isn't rejected — it's
// automatically split into consecutive 60-second parts, each cropped to
// 9:16 and compressed independently, ready to be posted as separate
// Reels. A clip that's already <=60s and already close to 9:16/small
// enough skips re-encoding entirely (fast path).

const SEGMENT_SECONDS = 60;
const MAX_PARTS = 10; // hard cap — a longer clip gets rejected up front with a clear message
const VIDEO_BITRATE = 2_500_000; // safe for any clip up to 60s within a 42MB budget
const ALREADY_OK_BYTES = 20 * 1024 * 1024;

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = URL.createObjectURL(file);
    video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
    video.addEventListener("error", () => reject(new Error("Could not read video metadata")), { once: true });
  });
}

// Some video files (certain Android recordings, some webm/mkv-derived
// mp4s) report duration as Infinity until the browser has actually
// seeked through them — a known browser quirk, not a broken file.
// Seeking far forward once forces the browser to resolve the real
// duration; without this, a 10-minute clip can silently get treated
// as if it were only ~60 seconds long.
function getReliableDuration(video) {
  return new Promise((resolve) => {
    if (isFinite(video.duration) && video.duration > 0) {
      resolve(video.duration);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", onSeeked);
      const fixed = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      video.currentTime = 0;
      resolve(fixed);
    };
    const onSeeked = () => finish();
    video.addEventListener("seeked", onSeeked);
    video.currentTime = 1e7; // seek far beyond any real video's length
    setTimeout(finish, 4000); // fallback in case 'seeked' never fires
  });
}

// Quick duration check without doing any cropping/encoding work — used
// to warn the user up front if a long clip is about to trigger a
// multi-part split.
export async function getVideoDuration(file) {
  const video = await loadVideo(file);
  const duration = await getReliableDuration(video);
  URL.revokeObjectURL(video.src);
  return duration;
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

function computeCropRect(vw, vh, targetWidth, targetHeight) {
  const srcRatio = vw / vh;
  const targetRatio = targetWidth / targetHeight;
  if (srcRatio > targetRatio) {
    const sh = vh, sw = vh * targetRatio;
    return { sx: (vw - sw) / 2, sy: 0, sw, sh };
  }
  const sw = vw, sh = vw / targetRatio;
  return { sx: 0, sy: (vh - sh) / 2, sw, sh };
}

// Crops+compresses one [startTime, endTime) slice of the source video.
function cropSegment(file, startTime, endTime, { targetWidth = 720, onProgress } = {}) {
  return new Promise((resolveOuter) => {
    let settled = false;
    const resolve = (v) => { if (!settled) { settled = true; resolveOuter(v); } };

    const segDuration = endTime - startTime;
    const targetHeight = Math.round((targetWidth * 16) / 9);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    const safetyMs = isFinite(segDuration) ? segDuration * 1000 + 20000 : 30 * 60 * 1000;
    const timeoutId = setTimeout(() => resolve(null), safetyMs);
    const cleanup = () => { clearTimeout(timeoutId); URL.revokeObjectURL(video.src); };

    video.addEventListener("error", () => { cleanup(); resolve(null); }, { once: true });

    video.addEventListener("loadedmetadata", () => {
      const { sx, sy, sw, sh } = computeCropRect(video.videoWidth, video.videoHeight, targetWidth, targetHeight);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      let canvasStream;
      try {
        canvasStream = canvas.captureStream(30);
      } catch (e) { cleanup(); resolve(null); return; }

      let mixedStream = canvasStream;
      try {
        const audioTracks = video.captureStream ? video.captureStream().getAudioTracks() : [];
        if (audioTracks.length > 0) mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      } catch (e) { /* proceed video-only */ }

      const mimeType = pickMimeType();
      if (!mimeType) { cleanup(); resolve(null); return; }

      let recorder;
      try {
        recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: VIDEO_BITRATE });
      } catch (e) { cleanup(); resolve(null); return; }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => { cleanup(); resolve(null); };
      recorder.onstop = () => {
        cleanup();
        if (onProgress) onProgress(1);
        if (chunks.length === 0) { resolve(null); return; }
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
        resolve(new File([blob], `reel.${ext}`, { type: blob.type }));
      };

      let rafId;
      function drawFrame() {
        if (video.paused || video.ended || video.currentTime >= endTime) return;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
        rafId = requestAnimationFrame(drawFrame);
      }
      const stop = () => { cancelAnimationFrame(rafId); if (recorder.state !== "inactive") recorder.stop(); };

      video.addEventListener("timeupdate", () => {
        if (onProgress) onProgress(Math.min(1, (video.currentTime - startTime) / segDuration));
        if (video.currentTime >= endTime) stop();
      });
      video.addEventListener("ended", stop);
      video.addEventListener("seeked", () => {
        recorder.start();
        video.play().catch(() => { cleanup(); resolve(null); });
        drawFrame();
      }, { once: true });

      video.currentTime = startTime;
    }, { once: true });
  });
}

// Main entry point. Returns an array of ready-to-upload File objects,
// each at most 60 seconds, cropped to 9:16. A single-part result means
// the source was already <=60s (only re-encoded if it needed cropping
// or was too large; otherwise the original file is returned untouched).
export async function splitReelInto1MinParts(file, { targetWidth = 720, onProgress } = {}) {
  let probe;
  try {
    probe = await loadVideo(file);
  } catch (e) {
    return [file]; // can't read metadata — upload as-is rather than block the user
  }
  const duration = await getReliableDuration(probe);
  const vw = probe.videoWidth, vh = probe.videoHeight;
  URL.revokeObjectURL(probe.src);

  const targetHeight = Math.round((targetWidth * 16) / 9);
  const targetRatio = targetWidth / targetHeight;
  const srcRatio = vw && vh ? vw / vh : targetRatio;

  if (!duration || duration <= 0) {
    // Truly couldn't determine length even after the seek workaround —
    // process the whole thing as one part, stopping at its natural end,
    // rather than guessing a duration and getting it wrong.
    const result = await cropSegment(file, 0, Infinity, {
      targetWidth,
      onProgress: (frac) => { if (onProgress) onProgress(0, 1, frac); },
    });
    return result ? [result] : [file];
  }

  // Fast path: already one short, already-portrait, already-small clip —
  // skip re-encoding entirely.
  if (duration <= SEGMENT_SECONDS && Math.abs(srcRatio - targetRatio) < 0.04 && file.size <= ALREADY_OK_BYTES) {
    if (onProgress) onProgress(0, 1, 1);
    return [file];
  }

  const partCount = Math.max(1, Math.ceil(duration / SEGMENT_SECONDS));
  if (partCount > MAX_PARTS) {
    const maxMinutes = Math.floor((MAX_PARTS * SEGMENT_SECONDS) / 60);
    throw new Error(
      `This video is too long (${Math.round(duration / 60)} min). Reels can be split into at most ${MAX_PARTS} parts — ` +
      `please trim it to under ${maxMinutes} minutes and try again.`
    );
  }

  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const start = i * SEGMENT_SECONDS;
    const end = Math.min(duration, start + SEGMENT_SECONDS);
    const result = await cropSegment(file, start, end, {
      targetWidth,
      onProgress: (frac) => { if (onProgress) onProgress(i, partCount, frac); },
    });
    // If a segment fails outright, skip it rather than aborting the
    // whole batch — the other parts still get posted.
    if (result) parts.push(result);
  }
  return parts;
}
