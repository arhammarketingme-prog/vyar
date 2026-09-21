// VYRA — Supabase client
// IMPORTANT: only the public anon key belongs here. Never put a service-role
// key in frontend code. Fill these from your Supabase project settings.

const SUPABASE_URL = "https://rvklvfymosdtnvbsyzxl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2a2x2Znltb3NkdG52YnN5enhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NjA0MTksImV4cCI6MjEwNDUzNjQxOX0.OhiiembkaQXVkogOBl-gpdx3_RkXB6hd2h3gsUiOT0s";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// The standard supabase-js storage .upload() call has no progress events
// (it's a plain fetch under the hood). This talks to the same Storage
// REST endpoint directly via XHR so we can show real upload progress —
// makes big Reel uploads feel far less stuck/frozen.
export function uploadWithProgress(bucket, path, file, accessToken, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, true);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || "unknown error"}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

// Redirects to login if there's no active session. Call this at the top of
// any page that requires auth.
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  const { data: profile } = await supabase.from("profiles").select("is_suspended").eq("id", session.user.id).single();
  if (profile?.is_suspended) {
    await supabase.auth.signOut({ scope: "local" });
    alert("Your account has been suspended. Contact support if you believe this is a mistake.");
    window.location.href = "login.html";
    return null;
  }

  return session;
}

export function showError(el, err) {
  const message = (err && err.message) ? err.message : "Something went wrong. Please try again.";
  el.textContent = message;
  el.classList.remove("hidden");
}

// A default avatar built entirely in code (data URI, no network request,
// so it never fails to load) — shows the person's first initial on the
// brand gradient, the way Gmail/Slack show initials when there's no
// uploaded photo, instead of a blank colored circle.
export function phAvatar(size = 40, name = "") {
  const initial = (name || "").trim().charAt(0).toUpperCase() || "?";
  const fontSize = Math.round(size * 0.45);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0a83a"/><stop offset="1" stop-color="#d9536f"/></linearGradient></defs><rect width="100%" height="100%" rx="${size / 2}" fill="url(#g)"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Manrope, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Relative time, Instagram-style: "2h", "3d", "1w" instead of a full date.
export function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

// Small blue verified checkmark, shown next to a username when is_verified is true.
export function verifiedBadge(isVerified) {
  return isVerified
    ? ` <span title="Verified" style="color:#3897f0;">✓</span>`
    : "";
}

// Register the service worker so the browser recognizes VYRA as an
// installable app ("Add to Home Screen" on mobile). Works whether this
// runs from the root index.html or from a page under pages/.
if ("serviceWorker" in navigator) {
  const swPath = location.pathname.includes("/pages/") ? "../service-worker.js" : "./service-worker.js";
  navigator.serviceWorker.register(swPath).catch(() => {});
}
