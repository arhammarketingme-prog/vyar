// VYRA — Supabase client
// IMPORTANT: only the public anon key belongs here. Never put a service-role
// key in frontend code. Fill these from your Supabase project settings.

const SUPABASE_URL = "https://rvklvfymosdtnvbsyzxl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2a2x2Znltb3NkdG52YnN5enhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NjA0MTksImV4cCI6MjEwNDUzNjQxOX0.OhiiembkaQXVkogOBl-gpdx3_RkXB6hd2h3gsUiOT0s";

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Redirects to login if there's no active session. Call this at the top of
// any page that requires auth.
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
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

// A gray circle placeholder built entirely in code (data URI) — no
// network request at all, so it never fails to load even on very slow
// or spotty connections (unlike fetching a placeholder from a third
// party service).
export function phAvatar(size = 40) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='100%' height='100%' rx='${size / 2}' fill='%237c5cff'/></svg>`;
  return `data:image/svg+xml,${svg}`;
}

// Register the service worker so the browser recognizes VYRA as an
// installable app ("Add to Home Screen" on mobile). Works whether this
// runs from the root index.html or from a page under pages/.
if ("serviceWorker" in navigator) {
  const swPath = location.pathname.includes("/pages/") ? "../service-worker.js" : "./service-worker.js";
  navigator.serviceWorker.register(swPath).catch(() => {});
}
