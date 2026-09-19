// Automatically center-crops an uploaded video to a 9:16 portrait frame
// (the standard Reel size) before it's uploaded — so a landscape clip,
// a square clip, or an already-portrait clip all end up looking right
// in the Reels player, with no manual cropping step for the user.
//
// How it works: draws each frame of the source video onto a 9:16 canvas
// (cropped from the center), captures that canvas as a stream, and
// re-records it with MediaRecorder — including the original audio track.
// If the browser is missing any of the required APIs, it quietly falls
// back to uploading the original file untouched rather than blocking
// the post.
export function autoCropTo9x16(file, { targetWidth = 720, onProgress } = {}) {
  return new Promise((resolveOuter) => {
    let settled = false;
    const resolve = (v) => {
      if (settled) return;
      settled = true;
      resolveOuter(v);
    };
    // Safety net only for the "metadata never loads" case — once we know
    // the clip's duration, this gets replaced by a duration-aware one
    // sized to how long the recording will actually take.
    let timeoutId = setTimeout(() => resolve(file), 20000);
    const finish = (v) => {
      clearTimeout(timeoutId);
      resolve(v);
    };

    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      finish(file);
      return;
    }

    const targetHeight = Math.round((targetWidth * 16) / 9);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);

    const cleanupAndFallback = () => {
      URL.revokeObjectURL(video.src);
      resolve(file);
    };

    video.addEventListener("error", cleanupAndFallback);

    video.addEventListener("loadedmetadata", () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) { cleanupAndFallback(); return; }

      const srcRatio = vw / vh;
      const targetRatio = targetWidth / targetHeight; // 9/16 portrait

      // Fast path: if the clip is already close to 9:16 and already
      // small enough to upload as-is, skip re-encoding entirely —
      // re-recording in real time is the slow part, so avoiding it
      // whenever it isn't actually needed makes uploads much faster.
      const ALREADY_OK_BYTES = 20 * 1024 * 1024;
      if (Math.abs(srcRatio - targetRatio) < 0.04 && file.size <= ALREADY_OK_BYTES) {
        cleanupAndFallback();
        return;
      }

      if (onProgress) onProgress(0);

      // Pick a video bitrate — and, if needed, a shorter duration — so
      // the output always fits our size budget automatically. Short
      // clips get full quality; longer ones get a lower bitrate; a
      // genuinely very long upload (~11+ minutes) gets trimmed to
      // however many seconds fit at the quality floor, and that's what
      // gets uploaded — no manual step for the user either way.
      const TARGET_BYTES = 42 * 1024 * 1024; // stay under Supabase's 50MB limit with margin
      const AUDIO_BITRATE = 128_000;
      const MIN_VIDEO_BITRATE = 400_000;
      const MAX_VIDEO_BITRATE = 2_500_000;
      const duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 30;
      const maxSecondsAtFloor = (TARGET_BYTES * 8) / (MIN_VIDEO_BITRATE + AUDIO_BITRATE);
      const recordSeconds = Math.min(duration, maxSecondsAtFloor);
      const willTrim = duration > maxSecondsAtFloor;
      const idealVideoBitrate = (TARGET_BYTES * 8) / recordSeconds - AUDIO_BITRATE;
      const videoBitrate = Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, idealVideoBitrate));

      // Now that we know how long the recording will actually take,
      // give it that much time plus a buffer for encoding overhead —
      // instead of the short "metadata didn't load" timeout.
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => resolve(file), recordSeconds * 1000 + 15000);

      let sx, sy, sw, sh;
      if (srcRatio > targetRatio) {
        // Wider than 9:16 (landscape/square) — crop the left/right edges.
        sh = vh;
        sw = vh * targetRatio;
        sx = (vw - sw) / 2;
        sy = 0;
      } else {
        // Narrower/taller than 9:16 — crop the top/bottom edges.
        sw = vw;
        sh = vw / targetRatio;
        sx = 0;
        sy = (vh - sh) / 2;
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      let canvasStream;
      try {
        canvasStream = canvas.captureStream(30);
      } catch (e) {
        cleanupAndFallback();
        return;
      }
      let mixedStream = canvasStream;
      try {
        const audioTracks = video.captureStream ? video.captureStream().getAudioTracks() : [];
        if (audioTracks.length > 0) {
          mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
        }
      } catch (e) {
        // Audio capture failed on this device/browser — keep going with a
        // video-only (silent) crop rather than aborting and falling back
        // to the full-size original file, which is often too large to
        // upload on the Free plan's 50MB limit.
      }

      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ];
      const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
      if (!mimeType) { cleanupAndFallback(); return; }

      let recorder;
      try {
        recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: Math.round(videoBitrate) });
      } catch (e) {
        cleanupAndFallback();
        return;
      }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = cleanupAndFallback;
      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        if (onProgress) onProgress(1);
        if (chunks.length === 0) { resolve(file); return; }
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
        resolve(new File([blob], `reel.${ext}`, { type: blob.type }));
      };

      let rafId;
      let stopTimerId;
      function drawFrame() {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
        rafId = requestAnimationFrame(drawFrame);
      }

      const stopRecording = () => {
        cancelAnimationFrame(rafId);
        clearTimeout(stopTimerId);
        if (recorder.state !== "inactive") recorder.stop();
      };

      video.addEventListener("timeupdate", () => {
        if (onProgress) onProgress(Math.min(1, video.currentTime / recordSeconds));
      });

      video.addEventListener("play", () => {
        recorder.start();
        drawFrame();
        if (willTrim) {
          // Clip is longer than fits our size budget — stop the
          // recording (and therefore the upload) at recordSeconds,
          // automatically using just the first part of the video.
          stopTimerId = setTimeout(stopRecording, recordSeconds * 1000);
        }
      });
      video.addEventListener("ended", stopRecording);

      video.play().catch(cleanupAndFallback);
    });
  });
}
