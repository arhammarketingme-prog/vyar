import { supabase, requireAuth } from "./supabaseClient.js";

export async function initCreatorStudio() {
  const session = await requireAuth();
  if (!session) return;

  await Promise.all([loadOverview(session), loadTopPosts(session), loadEarnings(session)]);
}

async function loadOverview(session) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("posts_count, followers_count, following_count")
    .eq("id", session.user.id)
    .single();

  const { data: posts } = await supabase
    .from("posts")
    .select("like_count, comment_count, save_count, post_type")
    .eq("author_id", session.user.id);

  const totals = (posts || []).reduce(
    (acc, p) => {
      acc.likes += p.like_count;
      acc.comments += p.comment_count;
      acc.saves += p.save_count;
      if (p.post_type === "reel") acc.reels += 1;
      else acc.photoPosts += 1;
      return acc;
    },
    { likes: 0, comments: 0, saves: 0, reels: 0, photoPosts: 0 }
  );

  document.getElementById("overview-grid").innerHTML = `
    <div class="stat-box"><strong>${profile?.followers_count ?? 0}</strong><div class="muted">Followers</div></div>
    <div class="stat-box"><strong>${totals.photoPosts}</strong><div class="muted">Photo Posts</div></div>
    <div class="stat-box"><strong>${totals.reels}</strong><div class="muted">Reels</div></div>
    <div class="stat-box"><strong>${totals.likes}</strong><div class="muted">Total Likes</div></div>
    <div class="stat-box"><strong>${totals.comments}</strong><div class="muted">Total Comments</div></div>
    <div class="stat-box"><strong>${totals.saves}</strong><div class="muted">Total Saves</div></div>
  `;
}

async function loadTopPosts(session) {
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, caption, like_count, comment_count, save_count, post_type, created_at")
    .eq("author_id", session.user.id)
    .order("like_count", { ascending: false })
    .limit(10);

  const el = document.getElementById("top-posts");
  if (error || !posts || posts.length === 0) {
    el.innerHTML = `<p class="muted">Post something to see performance here.</p>`;
    return;
  }

  el.innerHTML = posts
    .map(
      (p) => `
      <a href="post.html?id=${p.id}" class="search-result-row">
        <div>
          <strong>${p.post_type === "reel" ? "🎬" : "📷"} ${escapeHtml((p.caption || "").slice(0, 40) || "(no caption)")}</strong>
          <div class="muted">${p.like_count} likes · ${p.comment_count} comments · ${p.save_count} saves</div>
        </div>
      </a>`
    )
    .join("");
}

async function loadEarnings(session) {
  const { data: earnings, error } = await supabase
    .from("creator_earnings")
    .select("amount_inr, status, source, created_at")
    .eq("creator_id", session.user.id)
    .order("created_at", { ascending: false });

  const el = document.getElementById("earnings-summary");
  if (error || !earnings) {
    el.innerHTML = `<p class="muted">Could not load earnings.</p>`;
    return;
  }

  const totals = earnings.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + e.amount_inr;
      return acc;
    },
    { pending: 0, eligible: 0, paid: 0 }
  );

  el.innerHTML = `
    <div class="stat-box"><strong>₹${totals.pending}</strong><div class="muted">Pending</div></div>
    <div class="stat-box"><strong>₹${totals.eligible}</strong><div class="muted">Eligible</div></div>
    <div class="stat-box"><strong>₹${totals.paid}</strong><div class="muted">Paid</div></div>
  `;

  const list = document.getElementById("earnings-list");
  if (earnings.length === 0) {
    list.innerHTML = `<p class="muted">No earnings yet. Tips you receive will show up here.</p>`;
    return;
  }
  list.innerHTML = earnings
    .slice(0, 20)
    .map(
      (e) => `
      <div class="search-result-row">
        <span>${e.source} · ${new Date(e.created_at).toLocaleDateString()}</span>
        <span>₹${e.amount_inr} <span class="muted">(${e.status})</span></span>
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
