import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initCommunityDetail() {
  const session = await requireAuth();
  if (!session) return;

  const communityId = new URLSearchParams(window.location.search).get("id");
  if (!communityId) return;

  const { data: community, error } = await supabase
    .from("communities")
    .select("id, name, description, visibility, member_count")
    .eq("id", communityId)
    .single();

  if (error || !community) {
    document.getElementById("community-root").textContent = "Community not found or private.";
    return;
  }

  document.getElementById("community-root").innerHTML = `
    <h1 style="color:var(--vyra-accent); font-size:22px;">${escapeHtml(community.name)}</h1>
    <p class="muted">${community.visibility} · ${community.member_count} members</p>
    <p>${escapeHtml(community.description || "")}</p>
  `;

  await loadEvents(communityId, session);
  bindNewEventForm(communityId, session);

  const { data: posts } = await supabase
    .from("posts")
    .select(`
      id, caption, like_count, comment_count,
      author:profiles!posts_author_id_fkey(username, avatar_url, is_verified),
      post_media(storage_path, position)
    `)
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  const feed = document.getElementById("community-feed");
  if (!posts || posts.length === 0) {
    feed.innerHTML = `<p class="muted">No posts in this community yet.</p>`;
    return;
  }

  feed.innerHTML = posts
    .map((post) => {
      const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
      const url = media
        ? supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl
        : "";
      return `
        <a href="post.html?id=${post.id}" class="post card" style="display:block;">
          <div class="post-header">
            <img class="avatar" width="36" height="36" src="${post.author.avatar_url || phAvatar(40, post.author.display_name || post.author.username)}" alt="">
            <strong>${escapeHtml(post.author.username)}</strong>
          </div>
          ${url ? `<img src="${url}" style="width:100%; border-radius:12px;">` : ""}
          <div class="muted">${post.like_count} likes · ${post.comment_count} comments</div>
        </a>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadEvents(communityId, session) {
  const { data: events } = await supabase
    .from("community_events")
    .select("id, title, description, event_time, location, event_attendees(user_id, status)")
    .eq("community_id", communityId)
    .order("event_time", { ascending: true });

  const list = document.getElementById("events-list");
  if (!events || events.length === 0) {
    list.innerHTML = `<p class="muted">No events yet.</p>`;
    return;
  }

  list.innerHTML = events
    .map((ev) => {
      const goingCount = (ev.event_attendees || []).filter((a) => a.status === "going").length;
      const myStatus = (ev.event_attendees || []).find((a) => a.user_id === session.user.id)?.status;
      return `
        <div class="card">
          <strong>${escapeHtml(ev.title)}</strong>
          <div class="muted">${new Date(ev.event_time).toLocaleString()} ${ev.location ? "· " + escapeHtml(ev.location) : ""}</div>
          <p>${escapeHtml(ev.description || "")}</p>
          <div class="muted">${goingCount} going</div>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <button data-rsvp="${ev.id}" data-status="going" class="btn ${myStatus === "going" ? "" : "btn-secondary"}" style="width:auto; padding:6px 12px; font-size:13px;">Going</button>
            <button data-rsvp="${ev.id}" data-status="interested" class="btn ${myStatus === "interested" ? "" : "btn-secondary"}" style="width:auto; padding:6px 12px; font-size:13px;">Interested</button>
          </div>
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-rsvp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("event_attendees").upsert(
        { event_id: btn.dataset.rsvp, user_id: session.user.id, status: btn.dataset.status },
        { onConflict: "event_id,user_id" }
      );
      loadEvents(communityId, session);
    });
  });
}

function bindNewEventForm(communityId, session) {
  const form = document.getElementById("new-event-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    const eventTime = form.event_time.value;
    if (!title || !eventTime) return;
    const { error } = await supabase.from("community_events").insert({
      community_id: communityId,
      title,
      description: form.description.value.trim() || null,
      event_time: new Date(eventTime).toISOString(),
      location: form.location.value.trim() || null,
      created_by: session.user.id,
    });
    if (error) {
      alert(error.message);
      return;
    }
    form.reset();
    loadEvents(communityId, session);
  });
}
