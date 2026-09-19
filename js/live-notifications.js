import { supabase } from "./supabaseClient.js";

const labels = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "started following you",
  follow_request: "requested to follow you",
  mention_post: "mentioned you in a post",
  mention_comment: "mentioned you in a comment",
};

// Two-tone "ding" built with the Web Audio API — no audio file needed,
// works offline, and is short enough not to be annoying.
function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [0, 0.14].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1108;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch (e) {
    /* Web Audio not available — fail silently, toast still shows */
  }
}

function showToast(notification) {
  const el = document.createElement("div");
  el.className = "vyra-toast";
  el.style.cssText =
    "position:fixed; top:14px; left:50%; transform:translateX(-50%) translateY(-20px); z-index:999; " +
    "background:var(--vyra-surface); border:1px solid var(--vyra-border); color:var(--vyra-text); " +
    "border-radius:12px; padding:10px 16px; font-size:13.5px; display:flex; align-items:center; gap:8px; " +
    "box-shadow:0 12px 30px -12px rgba(0,0,0,0.5); opacity:0; transition:opacity .2s ease, transform .2s ease; " +
    "max-width:90vw; cursor:pointer;";
  el.textContent = "🔔 " + (labels[notification.type] || "New notification");
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  });
  const remove = () => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(-20px)";
    setTimeout(() => el.remove(), 250);
  };
  const timer = setTimeout(remove, 3500);
  el.addEventListener("click", () => {
    clearTimeout(timer);
    window.location.href = "notifications.html";
  });
}

function bumpBadge() {
  const badge = document.getElementById("bell-badge");
  if (!badge) return;
  const current = parseInt(badge.textContent, 10) || 0;
  const next = current + 1;
  badge.textContent = next > 9 ? "9+" : String(next);
  badge.classList.remove("hidden");
}

// Call once per page, after you have the session. Wires up: a live
// Realtime subscription for this user's notifications, an audible
// "alarm" ding, a toast, a live badge count, and (if the tab is in
// the background and the user has granted permission) a native
// browser notification too.
export function initLiveNotifications(session) {
  if (!session) return;

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  supabase
    .channel(`notifications:${session.user.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${session.user.id}` },
      (payload) => {
        playAlarm();
        showToast(payload.new);
        bumpBadge();
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          new Notification("VYRA", {
            body: labels[payload.new.type] || "New notification",
            icon: "../icons/icon-192.png",
          });
        }
      }
    )
    .subscribe();
}
