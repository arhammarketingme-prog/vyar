import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initStoriesBar() {
  const session = await requireAuth();
  if (!session) return;

  const bar = document.getElementById("stories-bar");
  if (!bar) return;

  // "Add story" ring always first.
  const addRing = document.createElement("div");
  addRing.style.textAlign = "center";
  addRing.innerHTML = `
    <a href="create-story.html" class="story-ring" style="display:flex; align-items:center; justify-content:center; background:var(--vyra-surface);">
      <span style="font-size:24px; color:var(--vyra-accent);">+</span>
    </a>
    <div class="story-label">Your story</div>
  `;
  bar.appendChild(addRing);

  // Active (non-expired) stories, grouped by author. RLS already filters
  // to people whose content this viewer is allowed to see.
  const { data: stories, error } = await supabase
    .from("stories")
    .select("id, author_id, author:profiles!stories_author_id_fkey(username, avatar_url)")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error || !stories) return;

  const byAuthor = new Map();
  for (const s of stories) {
    if (!byAuthor.has(s.author_id)) byAuthor.set(s.author_id, s.author);
  }

  byAuthor.forEach((author, authorId) => {
    const ring = document.createElement("div");
    ring.style.textAlign = "center";
    ring.innerHTML = `
      <a href="story-view.html?u=${encodeURIComponent(author.username)}" class="story-ring">
        <img src="${author.avatar_url || phAvatar(60)}" alt="">
      </a>
      <div class="story-label">${escapeHtml(author.username)}</div>
    `;
    bar.appendChild(ring);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
