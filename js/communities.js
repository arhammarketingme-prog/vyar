import { supabase, requireAuth, showError } from "./supabaseClient.js";

export async function initCommunities() {
  const session = await requireAuth();
  if (!session) return;

  await loadCommunities(session);

  const form = document.getElementById("new-community-form");
  const errEl = document.getElementById("new-community-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const name = form.name.value.trim();
    if (!name) return;

    const { error } = await supabase.from("communities").insert({
      name,
      description: form.description.value.trim() || null,
      visibility: form.visibility.value,
      creator_id: session.user.id,
    });
    if (error) {
      showError(errEl, error);
      return;
    }
    form.reset();
    await loadCommunities(session);
  });
}

async function loadCommunities(session) {
  const { data: communities, error } = await supabase
    .from("communities")
    .select("id, name, description, visibility, member_count")
    .order("member_count", { ascending: false });

  const { data: myMemberships } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("user_id", session.user.id);
  const myCommunityIds = new Set((myMemberships || []).map((m) => m.community_id));

  const list = document.getElementById("communities-list");
  if (error || !communities || communities.length === 0) {
    list.innerHTML = `<p class="muted">No communities yet. Start one below.</p>`;
    return;
  }

  list.innerHTML = communities
    .map((c) => {
      const isMember = myCommunityIds.has(c.id);
      return `
        <div class="card">
          <a href="community-detail.html?id=${c.id}"><strong>${escapeHtml(c.name)}</strong></a>
          <span class="muted"> · ${c.visibility} · ${c.member_count} members</span>
          <p class="muted">${escapeHtml(c.description || "")}</p>
          ${isMember ? `<span class="muted">✓ Joined</span>` : `<button class="btn" data-join="${c.id}" style="width:auto; padding:6px 14px;">Join</button>`}
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-join]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error: joinErr } = await supabase.from("community_members").insert({
        community_id: btn.dataset.join,
        user_id: session.user.id,
      });
      if (!joinErr) await loadCommunities(session);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
