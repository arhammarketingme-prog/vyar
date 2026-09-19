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

  // Some mobile browsers/WebViews ignore the muted/playsinline HTML
  // attributes when the <video> is built via innerHTML, and silently
  // block autoplay as a result (the poster frame just sits there).
  // Setting these as JS properties after insertion makes autoplay
  // actually work everywhere.
  document.querySelectorAll(".reel-slide video").forEach((video) => {
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("webkit-playsinline", "true");
  });

  // Autoplay the reel currently in view, pause the rest.
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target.querySelector("video");
        if (!video) return;
        if (entry.isIntersecting) {
          video.muted = true; // re-assert — some browsers reset this on reflow
          const playPromise = video.play();
          if (playPromise) playPromise.catch(() => showTapToPlay(entry.target, video));
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll(".reel-slide").forEach((el) => observer.observe(el));
}

function showTapToPlay(slide, video) {
  if (slide.querySelector(".tap-to-play")) return;
  const btn = document.createElement("div");
  btn.className = "tap-to-play";
  btn.textContent = "▶";
  btn.style.cssText =
    "position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:48px; color:white; background:rgba(0,0,0,0.25); cursor:pointer;";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.play().then(() => btn.remove()).catch(() => {});
  });
  slide.appendChild(btn);
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
