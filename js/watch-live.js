import { supabase, requireAuth } from "./supabaseClient.js";

export async function initWatchLive() {
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(location.search);
  const roomName = params.get("room");
  const statusEl = document.getElementById("live-status");
  const hostNameEl = document.getElementById("host-name");
  const viewerCountEl = document.getElementById("viewer-count");
  const remoteVideo = document.getElementById("remote-video");

  if (!roomName) {
    statusEl.textContent = "No stream specified.";
    return;
  }

  const { data: streamRow, error: streamErr } = await supabase
    .from("live_streams")
    .select("id, title, is_active, host:profiles!live_streams_host_id_fkey(username, display_name)")
    .eq("room_name", roomName)
    .single();

  if (streamErr || !streamRow) {
    statusEl.textContent = "Stream not found.";
    return;
  }
  if (!streamRow.is_active) {
    statusEl.textContent = "This stream has ended.";
    return;
  }

  hostNameEl.textContent = `@${streamRow.host.username}`;

  try {
    const { data: tokenData, error: tokenErr } = await supabase.functions.invoke("livekit-token", {
      body: { room: roomName, identity: session.user.id, name: session.user.email, canPublish: false },
    });
    if (tokenErr || tokenData?.error) throw new Error(tokenData?.error || tokenErr?.message || "Couldn't join this stream.");

    const LiveKit = await import("https://esm.sh/livekit-client@2");
    const room = new LiveKit.Room();

    room.on(LiveKit.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "video") {
        track.attach(remoteVideo);
        statusEl.classList.add("hidden");
      } else if (track.kind === "audio") {
        track.attach();
      }
    });
    room.on(LiveKit.RoomEvent.ParticipantConnected, updateCount);
    room.on(LiveKit.RoomEvent.ParticipantDisconnected, updateCount);
    room.on(LiveKit.RoomEvent.Disconnected, () => {
      statusEl.textContent = "Stream ended.";
      statusEl.classList.remove("hidden");
    });

    function updateCount() {
      viewerCountEl.textContent = `${Math.max(0, room.numParticipants - 1)} watching`;
    }

    await room.connect(tokenData.wsUrl, tokenData.token);
    updateCount();

    window.addEventListener("beforeunload", () => room.disconnect());
  } catch (err) {
    statusEl.textContent = err.message || "Couldn't join this stream.";
  }
}
