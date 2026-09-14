import { supabase, requireAuth, phAvatar, timeAgo, verifiedBadge } from "./supabaseClient.js";

const PAGE_SIZE = 10;
let cursor = null;   // created_at of the last loaded post, for pagination
let loading = false;
let session = null;
let postsRenderedCount = 0;
let activeCampaigns = [];
let campaignIndex = 0;
const impressedCampaigns = new Set(); // avoid double-logging the same campaign repeatedly

let mutedUserIds = new Set();

export async function initFeed() {
  session = await requireAuth();
  if (!session) return;
  const { data: mutes } = await supabase.from("mutes").select("muted_id").eq("muter_id", session.user.id);
  mutedUserIds = new Set((mutes || []).map((m) => m.muted_id));
  await loadActiveCampaigns();
  await loadMore();

  // Infinite scroll with a safeguard against firing repeatedly.
  window.addEventListener("scroll", () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 400;
    if (nearBottom) loadMore();
  });
}

async function loadActiveCampaigns() {
  const { data } = await supabase
    .from("campaigns")
    .select(`
      id, objective,
      post:posts!campaigns_post_id_fkey (
        id, caption, post_media(storage_path, position),
        author:profiles!posts_author_id_fkey(username, avatar_url, is_verified)
      )
    `)
    .eq("status", "active")
    .limit(10);
  activeCampaigns = data || [];
}

async function loadMore() {
  if (loading) return;
  loading = true;

  let query = supabase
    .from("posts")
    .select(`
      id, caption, created_at, like_count, comment_count, post_type,
      author:profiles!posts_author_id_fkey ( id, username, avatar_url, is_verified ),
      post_media ( storage_path, position, media_type, alt_text ),
      likes ( user_id ),
      saves ( user_id )
    `)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("created_at", cursor);

  const { data: posts, error } = await query;
  if (error) {
    console.error(error);
    loading = false;
    return;
  }

  if (posts.length > 0) {
    cursor = posts[posts.length - 1].created_at;
    const visible = posts.filter((p) => !mutedUserIds.has(p.author.id));
    visible.forEach((post) => {
      renderPost(post);
      postsRenderedCount++;
      const shouldShowSponsored =
        activeCampaigns.length > 0 &&
        (postsRenderedCount === 1 || postsRenderedCount % 5 === 0);
      if (shouldShowSponsored) {
        renderSponsoredPost(activeCampaigns[campaignIndex % activeCampaigns.length]);
        campaignIndex++;
      }
    });
  }
  loading = false;
}

function renderSponsoredPost(campaign) {
  const post = campaign.post;
  if (!post) return;
  const feedEl = document.getElementById("feed");
  const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
  const mediaUrl = media
    ? supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl
    : "";

  const el = document.createElement("article");
  el.className = "post card";
  el.style.borderColor = "var(--vyra-accent)";
  el.innerHTML = `
    <div class="post-header">
      <img class="avatar" width="36" height="36" src="${post.author.avatar_url || phAvatar(40)}" alt="">
      <strong>${escapeHtml(post.author.username)}</strong>
      <span class="muted" style="margin-left:auto;">Sponsored</span>
    </div>
    <div class="post-media">
      ${mediaUrl ? `<img src="${mediaUrl}" style="cursor:pointer;">` : ""}
    </div>
    <div>${escapeHtml(post.caption || "")}</div>
  `;

  const mediaImg = el.querySelector(".post-media img");
  if (mediaImg) {
    mediaImg.addEventListener("click", () => {
      logAdClick(campaign.id);
      window.location.href = `post.html?id=${post.id}`;
    });
  }

  feedEl.appendChild(el);

  // Log one impression per campaign per page load, once it's actually visible.
  if (!impressedCampaigns.has(campaign.id)) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        logAdImpression(campaign.id);
        impressedCampaigns.add(campaign.id);
        observer.disconnect();
      }
    });
    observer.observe(el);
  }
}

async function logAdImpression(campaignId) {
  await supabase.from("ad_impressions").insert({ campaign_id: campaignId, viewer_id: session.user.id });
}

async function logAdClick(campaignId) {
  await supabase.from("ad_clicks").insert({ campaign_id: campaignId, viewer_id: session.user.id });
}

export async function loadFollowing() {
  const { data: follows } = await supabase.from("follows").select("following_id").eq("follower_id", session.user.id).eq("status", "accepted");
  const followingIds = (follows || []).map((f) => f.following_id);

  const feedEl = document.getElementById("feed");
  if (followingIds.length === 0) {
    feedEl.innerHTML = `<p class="muted">You're not following anyone yet — posts from people you follow will show up here.</p>`;
    return;
  }

  const { data: posts, error } = await supabase
    .from("posts")
    .select(`
      id, caption, created_at, like_count, comment_count, post_type,
      author:profiles!posts_author_id_fkey ( id, username, avatar_url, is_verified ),
      post_media ( storage_path, position, media_type, alt_text ),
      likes ( user_id ),
      saves ( user_id )
    `)
    .in("author_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error || !posts || posts.length === 0) {
    feedEl.innerHTML = `<p class="muted">No posts yet from people you follow.</p>`;
    return;
  }
  posts.filter((p) => !mutedUserIds.has(p.author.id)).forEach((post) => renderPost(post));
}

export async function loadRecommended() {
  // A real, simple heuristic — NOT a machine-learning recommender.
  // Score = engagement (weighted) with a recency decay, computed here
  // in JS from the last 100 posts. Good enough for a small/medium
  // community; would need a proper ranking service at real scale.
  const { data: posts, error } = await supabase
    .from("posts")
    .select(`
      id, caption, created_at, like_count, comment_count, save_count, post_type,
      author:profiles!posts_author_id_fkey ( id, username, avatar_url, is_verified ),
      post_media ( storage_path, position, media_type, alt_text ),
      likes ( user_id ),
      saves ( user_id )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !posts) return;

  const now = Date.now();
  const scored = posts.map((p) => {
    const ageHours = (now - new Date(p.created_at).getTime()) / 3600000;
    const engagement = p.like_count * 2 + p.comment_count * 3 + p.save_count * 4;
    const score = engagement / Math.pow(ageHours + 2, 1.3); // decay favors recent + engaging
    return { post: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.slice(0, 20).forEach((s) => renderPost(s.post));
}

function renderPost(post) {
  const feedEl = document.getElementById("feed");
  const mediaList = (post.post_media || []).sort((a, b) => a.position - b.position);
  const likedByMe = (post.likes || []).some((l) => l.user_id === session.user.id);
  const savedByMe = (post.saves || []).some((s) => s.user_id === session.user.id);

  const el = document.createElement("article");
  el.className = "post card";
  el.innerHTML = `
    <div class="post-header">
      <img class="avatar" width="36" height="36" src="${post.author.avatar_url || phAvatar(40)}" alt="">
      <strong>${escapeHtml(post.author.username)}${verifiedBadge(post.author.is_verified)}</strong>
      <span class="muted" style="margin-left:8px;">· ${timeAgo(post.created_at)}</span>
      ${post.post_type === "reel" ? `<span class="muted" style="margin-left:auto;">🎬 Reel</span>` : ""}
    </div>
    <div class="post-media" style="position:relative;">
      ${renderCarousel(mediaList)}
      <div class="like-burst" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:80px; opacity:0; pointer-events:none; transition:opacity 0.2s, transform 0.2s; transform:scale(0.8);">❤️</div>
    </div>
    <div class="post-actions">
      <button data-action="like" class="${likedByMe ? "active" : ""}">${likedByMe ? "♥" : "♡"}</button>
      <button data-action="comment">💬</button>
      <button data-action="save" class="${savedByMe ? "active" : ""}">${savedByMe ? "🔖" : "📑"}</button>
    </div>
    <div class="muted"><span class="like-count">${post.like_count}</span> likes</div>
    <div>${linkifyCaption(post.caption || "")}</div>
    <a href="post.html?id=${post.id}" class="muted comment-count" style="display:block; margin-top:4px;">View all ${post.comment_count} comments</a>
  `;

  const likeBtn = el.querySelector('[data-action="like"]');
  const mediaEl = el.querySelector(".post-media");
  const burst = el.querySelector(".like-burst");

  const doLike = () => {
    if (!likeBtn.classList.contains("active")) toggleLike(post.id, false, likeBtn);
    burst.style.opacity = "1";
    burst.style.transform = "scale(1.1)";
    setTimeout(() => (burst.style.opacity = "0"), 500);
  };

  let lastTap = 0;
  mediaEl.addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTap < 300) doLike();
    lastTap = now;
  });

  likeBtn.addEventListener("click", (e) => toggleLike(post.id, likeBtn.classList.contains("active"), e.target));
  el.querySelector('[data-action="save"]').addEventListener("click", (e) => toggleSave(post.id, savedByMe, e.target));
  el.querySelector('[data-action="comment"]').addEventListener("click", () => {
    window.location.href = `post.html?id=${post.id}`;
  });

  feedEl.appendChild(el);
}

function renderCarousel(mediaList) {
  if (mediaList.length === 0) return "";
  const items = mediaList
    .map((media) => {
      const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
      return media.media_type === "video"
        ? `<video src="${url}" controls playsinline style="width:100%; flex-shrink:0; scroll-snap-align:start; border-radius:12px;"></video>`
        : `<img src="${url}" alt="${escapeHtml(media.alt_text || "")}" style="width:100%; flex-shrink:0; scroll-snap-align:start; border-radius:12px;">`;
    })
    .join("");
  const dots = mediaList.length > 1
    ? `<div style="text-align:center; margin-top:6px;">${mediaList.map(() => "●").join(" ")} <span class="muted" style="font-size:11px;">(swipe →)</span></div>`
    : "";
  return `<div style="display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:4px;">${items}</div>${dots}`;
}

function linkifyCaption(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/@([a-zA-Z0-9_.]{3,30})/g, `<a href="profile.html?u=$1" style="color:var(--vyra-accent);">@$1</a>`)
    .replace(/#(\w+)/g, `<a href="hashtag.html?tag=$1" style="color:var(--vyra-accent);">#$1</a>`);
}

async function toggleLike(postId, currentlyLiked, btnEl) {
  if (currentlyLiked) {
    await supabase.from("likes").delete().eq("post_id", postId).eq("user_id", session.user.id);
    btnEl.textContent = "♡";
    btnEl.classList.remove("active");
  } else {
    await supabase.from("likes").insert({ post_id: postId, user_id: session.user.id });
    btnEl.textContent = "♥";
    btnEl.classList.add("active");
  }
}

async function toggleSave(postId, currentlySaved, btnEl) {
  if (currentlySaved) {
    await supabase.from("saves").delete().eq("post_id", postId).eq("user_id", session.user.id);
    btnEl.textContent = "📑";
    btnEl.classList.remove("active");
  } else {
    await supabase.from("saves").insert({ post_id: postId, user_id: session.user.id });
    btnEl.textContent = "🔖";
    btnEl.classList.add("active");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
