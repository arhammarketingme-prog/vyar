import { supabase, requireAuth } from "./supabaseClient.js";

export async function initReels() {
  const session = await requireAuth();
  if (!session) return;

  const { data: reels, error } = await supabase
    .from("posts")
    .select(`
      id, caption, created_at, like_count, comment_count,
      author:profiles!posts_author_id_fkey ( username, avatar_url ),
      post_media ( storage_path, position )
    `)
    .eq("post_type", "reel")
    .order("created_at", { ascending: false })
    .limit(20);

  const container = document.getElementById("reels-container");
  if (error || !reels || reels.length === 0) {
    container.innerHTML = `<div class="card" style="margin:16px;">No reels yet — be the first to post one from the create page.</div>`;
    return;
  }

  reels.forEach((reel) => container.appendChild(renderReel(reel, session)));

  // Autoplay the reel currently in view, pause the rest.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector("video");
        if (!video) return;
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll(".reel-slide").forEach((el) => observer.observe(el));
}

function renderReel(reel, session) {
  const media = (reel.post_media || []).sort((a, b) => a.position - b.position)[0];
  const url = media
    ? supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl
    : "";

  const slide = document.createElement("div");
  slide.className = "reel-slide";
  slide.innerHTML = `
    <video src="${url}" loop muted playsinline style="width:100%; height:100%; object-fit:cover;"></video>
    <div class="reel-overlay">
      <strong>@${escapeHtml(reel.author.username)}</strong>
      <p>${escapeHtml(reel.caption || "")}</p>
      <div class="muted">${reel.like_count} likes · ${reel.comment_count} comments</div>
    </div>
  `;
  slide.addEventListener("click", (e) => {
    const video = slide.querySelector("video");
    if (video.paused) video.play();
    else video.pause();
  });
  return slide;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
