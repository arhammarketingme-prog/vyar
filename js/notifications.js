import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initNotifications() {
  const session = await requireAuth();
  if (!session) return;

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select(`
      id, type, created_at, read_at, post_id,
      actor:profiles!notifications_actor_id_fkey(username, avatar_url)
    `)
    .eq("recipient_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const list = document.getElementById("notifications-list");
  if (error || !notifications || notifications.length === 0) {
    list.innerHTML = `<p class="muted">No notifications yet.</p>`;
    return;
  }

  const labels = {
    like: "liked your post",
    comment: "commented on your post",
    follow: "started following you",
    follow_request: "requested to follow you",
    mention_post: "mentioned you in a post",
    mention_comment: "mentioned you in a comment",
  };

  list.innerHTML = notifications
    .map((n) => {
      const link = n.type === "follow" || n.type === "follow_request" ? `profile.html?u=${n.actor.username}` : n.post_id ? `post.html?id=${n.post_id}` : "#";
      return `
      <a href="${link}" class="search-result-row" style="${n.read_at ? "" : "background:rgba(255,93,59,0.08);"}">
        <img class="avatar" width="36" height="36" src="${n.actor?.avatar_url || phAvatar(40)}" alt="">
        <div>
          <strong>${escapeHtml(n.actor?.username || "Someone")}</strong> ${labels[n.type] || n.type}
          <div class="muted">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      </a>`;
    })
    .join("");

  // Mark everything as read now that the user has seen the list.
  const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
  if (unreadIds.length > 0) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
