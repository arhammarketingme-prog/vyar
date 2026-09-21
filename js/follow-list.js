import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initFollowList() {
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(location.search);
  const username = params.get("u");
  const type = params.get("type") === "following" ? "following" : "followers"; // default to followers

  const titleEl = document.getElementById("list-title");
  const root = document.getElementById("follow-list-root");

  // Resolve the profile whose list we're viewing (defaults to the
  // logged-in user if no username was passed).
  const { data: profile, error: profileErr } = username
    ? await supabase.from("profiles").select("id, username").eq("username", username).single()
    : await supabase.from("profiles").select("id, username").eq("id", session.user.id).single();

  if (profileErr || !profile) {
    root.innerHTML = `<p class="muted">Profile not found.</p>`;
    return;
  }

  titleEl.textContent = type === "following" ? `Following · @${profile.username}` : `Followers · @${profile.username}`;

  const { data: rows, error } = type === "following"
    ? await supabase
        .from("follows")
        .select("following_id, user:profiles!follows_following_id_fkey(username, display_name, avatar_url, is_verified)")
        .eq("follower_id", profile.id)
        .eq("status", "accepted")
    : await supabase
        .from("follows")
        .select("follower_id, user:profiles!follows_follower_id_fkey(username, display_name, avatar_url, is_verified)")
        .eq("following_id", profile.id)
        .eq("status", "accepted");

  if (error) {
    root.innerHTML = `<p class="muted">Couldn't load this list — please try again.</p>`;
    return;
  }

  if (!rows || rows.length === 0) {
    root.innerHTML = type === "following"
      ? `<p class="muted">Not following anyone yet.</p>`
      : `<p class="muted">No followers yet.</p>`;
    return;
  }

  root.innerHTML = rows
    .map((r) => {
      const u = r.user;
      if (!u) return "";
      const name = u.display_name || u.username;
      return `
        <a href="profile.html?u=${encodeURIComponent(u.username)}" class="search-result-row" style="text-decoration:none; color:inherit;">
          <img class="avatar" width="40" height="40" src="${u.avatar_url || phAvatar(44, name)}" alt="">
          <div style="flex:1; min-width:0;">
            <strong>${escapeHtml(name)}${u.is_verified ? " ✅" : ""}</strong>
            <div class="muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">@${escapeHtml(u.username)}</div>
          </div>
        </a>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
