import { supabase, requireAuth } from "./supabaseClient.js";

export async function initGoLive() {
  const session = await requireAuth();
  if (!session) return;

  const { data: profile } = await supabase.from("profiles").select("username, display_name").eq("id", session.user.id).single();
  const roomName = `live-${session.user.id}-${Date.now()}`;

  const startBtn = document.getElementById("start-live-btn");
  const endBtn = document.getElementById("end-live-btn");
  const errEl = document.getElementById("live-error");
  const preLive = document.getElementById("pre-live");
  const inLive = document.getElementById("in-live");
  const localVideo = document.getElementById("local-video");
  const viewerCountEl = document.getElementById("viewer-count");

  let room = null;
  let streamRowId = null;

  startBtn.addEventListener("click", async () => {
    errEl.classList.add("hidden");
    startBtn.disabled = true;
    startBtn.textContent = "Starting…";

    try {
      const { data: streamRow, error: insertErr } = await supabase
        .from("live_streams")
        .insert({
          host_id: session.user.id,
          room_name: roomName,
          title: document.getElementById("stream-title").value.trim() || null,
        })
        .select()
        .single();
      if (insertErr) throw insertErr;
      streamRowId = streamRow.id;

      const { data: tokenData, error: tokenErr } = await supabase.functions.invoke("livekit-token", {
        body: { room: roomName, identity: session.user.id, name: profile?.display_name || profile?.username, canPublish: true },
      });
      if (tokenErr || tokenData?.error) throw new Error(tokenData?.error || tokenErr?.message || "Couldn't get a live token.");

      const LiveKit = await import("https://esm.sh/livekit-client@2");
      room = new LiveKit.Room();

      room.on(LiveKit.RoomEvent.ParticipantConnected, updateViewerCount);
      room.on(LiveKit.RoomEvent.ParticipantDisconnected, updateViewerCount);

      await room.connect(tokenData.wsUrl, tokenData.token);
      await room.localParticipant.setCameraEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(true);

      const camPub = room.localParticipant.getTrackPublication(LiveKit.Track.Source.Camera);
      if (camPub?.track) camPub.track.attach(localVideo);

      preLive.classList.add("hidden");
      inLive.classList.remove("hidden");
      updateViewerCount();
    } catch (err) {
      errEl.textContent = err.message || "Couldn't start the live stream.";
      errEl.classList.remove("hidden");
      startBtn.disabled = false;
      startBtn.textContent = "Start Live Stream";
      if (streamRowId) await supabase.from("live_streams").delete().eq("id", streamRowId);
    }
  });

  function updateViewerCount() {
    if (!room) return;
    viewerCountEl.textContent = Math.max(0, room.numParticipants - 1);
  }

  endBtn.addEventListener("click", async () => {
    endBtn.disabled = true;
    if (room) room.disconnect();
    if (streamRowId) {
      await supabase.from("live_streams").update({ is_active: false, ended_at: new Date().toISOString() }).eq("id", streamRowId);
    }
    window.location.href = "profile.html";
  });

  window.addEventListener("beforeunload", () => {
    if (room) room.disconnect();
  });
}
