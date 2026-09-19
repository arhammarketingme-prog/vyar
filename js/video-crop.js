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
export function autoCropTo9x16(file, { targetWidth = 720, timeoutMs = 45000 } = {}) {
  return new Promise((resolveOuter) => {
    let settled = false;
    const resolve = (v) => {
      if (settled) return;
      settled = true;
      resolveOuter(v);
    };
    const timeoutId = setTimeout(() => resolve(file), timeoutMs);
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
        recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 1_800_000 });
      } catch (e) {
        cleanupAndFallback();
        return;
      }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = cleanupAndFallback;
      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        if (chunks.length === 0) { resolve(file); return; }
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
        resolve(new File([blob], `reel.${ext}`, { type: blob.type }));
      };

      let rafId;
      function drawFrame() {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
        rafId = requestAnimationFrame(drawFrame);
      }

      video.addEventListener("play", () => {
        recorder.start();
        drawFrame();
      });
      video.addEventListener("ended", () => {
        cancelAnimationFrame(rafId);
        recorder.stop();
      });

      video.play().catch(cleanupAndFallback);
    });
  });
}
