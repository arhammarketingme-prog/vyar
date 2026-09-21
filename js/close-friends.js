import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initCloseFriends() {
  const session = await requireAuth();
  if (!session) return;

  const root = document.getElementById("close-friends-root");

  // Candidates are people who follow you — the same pool Instagram picks
  // close friends from, since they're the ones who'd see your stories anyway.
  const { data: followerRows, error: followerErr } = await supabase
    .from("follows")
    .select("follower_id, user:profiles!follows_follower_id_fkey(id, username, display_name, avatar_url)")
    .eq("following_id", session.user.id)
    .eq("status", "accepted");

  if (followerErr) {
    root.innerHTML = `<p class="muted">Couldn't load your followers — please try again.</p>`;
    return;
  }

  if (!followerRows || followerRows.length === 0) {
    root.innerHTML = `<p class="muted">No followers yet — once people follow you, you can add them here.</p>`;
    return;
  }

  const { data: closeRows } = await supabase
    .from("close_friends")
    .select("friend_id")
    .eq("owner_id", session.user.id);
  const closeSet = new Set((closeRows || []).map((r) => r.friend_id));

  root.innerHTML = followerRows
    .map((r) => {
      const u = r.user;
      if (!u) return "";
      const name = u.display_name || u.username;
      const isClose = closeSet.has(u.id);
      return `
        <label class="search-result-row" style="cursor:pointer;">
          <img class="avatar" width="40" height="40" src="${u.avatar_url || phAvatar(44, name)}" alt="">
          <div style="flex:1; min-width:0;">
            <strong>${escapeHtml(name)}</strong>
            <div class="muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">@${escapeHtml(u.username)}</div>
          </div>
          <input type="checkbox" data-friend-id="${u.id}" ${isClose ? "checked" : ""} style="width:20px; height:20px; accent-color:var(--vyra-accent);">
        </label>`;
    })
    .join("");

  root.querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.addEventListener("change", async () => {
      const friendId = box.dataset.friendId;
      box.disabled = true;
      if (box.checked) {
        await supabase.from("close_friends").insert({ owner_id: session.user.id, friend_id: friendId });
      } else {
        await supabase.from("close_friends").delete().eq("owner_id", session.user.id).eq("friend_id", friendId);
      }
      box.disabled = false;
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
