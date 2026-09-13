import { supabase, requireAuth } from "./supabaseClient.js";

export async function initFollowRequests() {
  const session = await requireAuth();
  if (!session) return;

  await loadRequests(session);
}

async function loadRequests(session) {
  const { data: requests, error } = await supabase
    .from("follows")
    .select("follower_id, created_at, follower:profiles!follows_follower_id_fkey(username, avatar_url)")
    .eq("following_id", session.user.id)
    .eq("status", "pending");

  const list = document.getElementById("requests-list");
  if (error || !requests || requests.length === 0) {
    list.innerHTML = `<p class="muted">No pending follow requests.</p>`;
    return;
  }

  list.innerHTML = requests
    .map(
      (r) => `
      <div class="card" style="display:flex; align-items:center; gap:10px;">
        <img class="avatar" width="36" height="36" src="${r.follower.avatar_url || "data:,"}" alt="">
        <strong style="flex:1;">${escapeHtml(r.follower.username)}</strong>
        <button class="btn" style="width:auto; padding:6px 12px;" data-accept="${r.follower_id}">Accept</button>
        <button class="btn btn-secondary" style="width:auto; padding:6px 12px;" data-reject="${r.follower_id}">Reject</button>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-accept]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase
        .from("follows")
        .update({ status: "accepted" })
        .eq("follower_id", btn.dataset.accept)
        .eq("following_id", session.user.id);
      await loadRequests(session);
    });
  });

  list.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase
        .from("follows")
        .delete()
        .eq("follower_id", btn.dataset.reject)
        .eq("following_id", session.user.id);
      await loadRequests(session);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
