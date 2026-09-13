import { supabase, requireAuth } from "./supabaseClient.js";

export async function initExplore() {
  const session = await requireAuth();
  if (!session) return;
  await loadTrendingHashtags();
  await loadExploreGrid();
}

async function loadTrendingHashtags() {
  const { data: tags, error } = await supabase
    .from("hashtags")
    .select("tag, post_count")
    .order("post_count", { ascending: false })
    .limit(12);

  const wrap = document.getElementById("trending-tags");
  if (error || !tags || tags.length === 0) {
    wrap.innerHTML = `<p class="muted">No hashtags yet — be the first to post one.</p>`;
    return;
  }

  wrap.innerHTML = tags
    .map(
      (t) =>
        `<a href="hashtag.html?tag=${encodeURIComponent(t.tag)}" class="tag-chip">#${escapeHtml(t.tag)} <span class="muted">${t.post_count}</span></a>`
    )
    .join("");
}

async function loadExploreGrid() {
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, post_media(storage_path, position)")
    .eq("post_type", "post")
    .order("created_at", { ascending: false })
    .limit(30);

  const grid = document.getElementById("explore-grid");
  if (error || !posts) return;

  grid.innerHTML = "";
  posts.forEach((post) => {
    const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
    if (!media) return;
    const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.aspectRatio = "1";
    img.style.objectFit = "cover";
    img.style.cursor = "pointer";
    img.addEventListener("click", () => (window.location.href = `post.html?id=${post.id}`));
    grid.appendChild(img);
  });

  if (posts.length === 0) {
    grid.innerHTML = `<p class="muted">Nothing to explore yet — the feed fills up as people post.</p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
