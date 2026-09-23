import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initExplore() {
  const session = await requireAuth();
  if (!session) return;
  await loadNearbyPeople();
  await loadTrendingHashtags();
  await loadSuggestedAccounts(session);
  await loadPopularReels();
  await loadExploreGrid();
}

async function loadNearbyPeople() {
  const el = document.getElementById("nearby-people");
  if (!("geolocation" in navigator)) {
    el.innerHTML = `<p class="muted">Your browser doesn't support location.</p>`;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { data, error } = await supabase.rpc("nearby_profiles", {
        viewer_lat: pos.coords.latitude,
        viewer_lng: pos.coords.longitude,
        radius_km: 25,
        max_results: 20,
      });
      if (error || !data || data.length === 0) {
        el.innerHTML = `<p class="muted">No one nearby has shared their location yet.</p>`;
        return;
      }
      el.innerHTML = data
        .map((p) => {
          const name = p.display_name || p.username;
          return `
            <a href="profile.html?u=${encodeURIComponent(p.username)}" style="text-align:center; flex-shrink:0; width:84px; text-decoration:none; color:inherit;">
              <img src="${p.avatar_url || phAvatar(56, name)}" width="56" height="56" style="border-radius:50%; object-fit:cover;" alt="">
              <div style="font-size:12px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.username)}</div>
              <div class="muted" style="font-size:10.5px;">${p.distance_km.toFixed(1)} km</div>
            </a>`;
        })
        .join("");
    },
    () => { el.innerHTML = `<p class="muted">Share your location (in Edit Profile) to see who's nearby.</p>`; },
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

async function loadSuggestedAccounts(session) {
  const { data: myFollows } = await supabase.from("follows").select("following_id").eq("follower_id", session.user.id);
  const excludeIds = new Set([session.user.id, ...(myFollows || []).map((f) => f.following_id)]);

  const { data: candidates } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, followers_count")
    .order("followers_count", { ascending: false })
    .limit(30);

  const suggestions = (candidates || []).filter((p) => !excludeIds.has(p.id)).slice(0, 8);
  const wrap = document.getElementById("suggested-accounts");
  if (suggestions.length === 0) {
    wrap.innerHTML = `<p class="muted">No suggestions right now.</p>`;
    return;
  }
  wrap.innerHTML = suggestions
    .map(
      (p) => `
      <a href="profile.html?u=${encodeURIComponent(p.username)}" style="text-align:center; flex-shrink:0; width:80px;">
        <img width="56" height="56" src="${p.avatar_url || phAvatar(56, p.display_name || p.username)}" style="width:56px; height:56px; border-radius:50%; object-fit:cover;">
        <div style="font-size:12px; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(p.username)}</div>
      </a>`
    )
    .join("");
}

async function loadPopularReels() {
  const { data: reels } = await supabase
    .from("posts")
    .select("id, like_count, post_media(storage_path, position)")
    .eq("post_type", "reel")
    .order("like_count", { ascending: false })
    .limit(9);

  const wrap = document.getElementById("popular-reels");
  if (!reels || reels.length === 0) {
    wrap.innerHTML = `<p class="muted">No reels yet.</p>`;
    return;
  }
  wrap.innerHTML = "";
  reels.forEach((reel) => {
    const media = (reel.post_media || [])[0];
    if (!media) return;
    const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
    const el = document.createElement("video");
    el.src = url;
    el.muted = true;
    el.style.cssText = "width:100%; aspect-ratio:9/16; object-fit:cover; border-radius:8px; cursor:pointer;";
    el.addEventListener("click", () => (window.location.href = `post.html?id=${reel.id}`));
    wrap.appendChild(el);
  });
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
