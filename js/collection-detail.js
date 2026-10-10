import { supabase, requireAuth } from "./supabaseClient.js";

export async function initCollectionDetail() {
  const session = await requireAuth();
  if (!session) return;

  const collectionId = new URLSearchParams(window.location.search).get("id");
  if (!collectionId) return;

  const { data: collection, error: colErr } = await supabase
    .from("collections")
    .select("id, name, is_private, owner_id")
    .eq("id", collectionId)
    .single();

  if (colErr || !collection) {
    document.getElementById("collection-title").textContent = "Collection not found.";
    return;
  }

  document.getElementById("collection-title").textContent = collection.name;

  const isOwner = collection.owner_id === session.user.id;

  async function renderMembers() {
    const { data: members } = await supabase
      .from("collection_members")
      .select("user_id, user:profiles!collection_members_user_id_fkey(username, display_name)")
      .eq("collection_id", collectionId);

    const section = document.getElementById("members-section");
    const listEl = document.getElementById("members-list");
    const iAmMember = (members || []).some((m) => m.user_id === session.user.id);

    // Show the section to the owner (so they can invite) and to members;
    // hide it for a visitor viewing a public collection they have no part in.
    if (!isOwner && !iAmMember) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    document.getElementById("invite-row").style.display = isOwner ? "flex" : "none";

    const rows = (members || []).map((m) => {
      const name = escapeHtml(m.user.display_name || m.user.username);
      const action =
        isOwner || m.user_id === session.user.id
          ? `<button data-remove-member="${m.user_id}" style="background:none; border:none; color:var(--vyra-accent-2); cursor:pointer; margin-left:8px;">${m.user_id === session.user.id && !isOwner ? "Leave" : "Remove"}</button>`
          : "";
      return `<div style="padding:3px 0;">@${escapeHtml(m.user.username)} <span class="muted">${name}</span>${action}</div>`;
    });
    listEl.innerHTML = rows.length ? rows.join("") : `<span class="muted">Only you so far — invite someone to build it together.</span>`;

    listEl.querySelectorAll("[data-remove-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.removeMember;
        await supabase.from("collection_members").delete().eq("collection_id", collectionId).eq("user_id", uid);
        if (uid === session.user.id && !isOwner) {
          window.location.href = "collections.html";
          return;
        }
        renderMembers();
      });
    });
  }

  document.getElementById("invite-btn").addEventListener("click", async () => {
    const msg = document.getElementById("invite-msg");
    const username = document.getElementById("invite-username").value.trim();
    if (!username) return;
    const { data: target } = await supabase.from("profiles").select("id").eq("username", username).single();
    if (!target) {
      msg.textContent = `No user named "${username}".`;
      return;
    }
    if (target.id === session.user.id) {
      msg.textContent = "You're already the owner.";
      return;
    }
    const { error: inviteErr } = await supabase.from("collection_members").insert({ collection_id: collectionId, user_id: target.id });
    if (inviteErr) {
      msg.textContent = inviteErr.code === "23505" ? "They're already a member." : "Couldn't add them — please try again.";
      return;
    }
    msg.textContent = `Added @${username}. They can now add posts to this collection.`;
    document.getElementById("invite-username").value = "";
    renderMembers();
  });

  await renderMembers();

  const { data: items, error } = await supabase
    .from("collection_items")
    .select("post_id, posts(id, post_media(storage_path, position))")
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  const grid = document.getElementById("collection-grid");
  if (error || !items || items.length === 0) {
    grid.innerHTML = `<p class="muted">No posts in this collection yet.</p>`;
    return;
  }

  grid.innerHTML = "";
  items.forEach((item) => {
    const post = item.posts;
    if (!post) return;
    const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
    if (!media) return;
    const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.aspectRatio = "1";
    img.style.objectFit = "cover";
    img.style.cursor = "pointer";
    img.addEventListener("click", () => (window.location.href = `post.html?id=${post.id}`));
    grid.appendChild(img);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
