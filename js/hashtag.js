import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initHashtagFeed() {
  const session = await requireAuth();
  if (!session) return;

  const tag = new URLSearchParams(window.location.search).get("tag");
  if (!tag) return;
  document.getElementById("hashtag-title").textContent = "#" + tag;

  const { data: hashtag } = await supabase.from("hashtags").select("id, post_count").eq("tag", tag.toLowerCase()).maybeSingle();
  if (!hashtag) {
    document.getElementById("hashtag-feed").innerHTML = `<p class="muted">No posts with this hashtag yet.</p>`;
    return;
  }
  document.getElementById("hashtag-count").textContent = `${hashtag.post_count} posts`;

  const { data: links } = await supabase
    .from("post_hashtags")
    .select("post:posts(id, caption, like_count, comment_count, post_media(storage_path, position), author:profiles!posts_author_id_fkey(username, avatar_url))")
    .eq("hashtag_id", hashtag.id);

  const feed = document.getElementById("hashtag-feed");
  const posts = (links || []).map((l) => l.post).filter(Boolean);
  if (posts.length === 0) {
    feed.innerHTML = `<p class="muted">No posts with this hashtag yet.</p>`;
    return;
  }

  feed.innerHTML = posts
    .map((post) => {
      const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
      const url = media ? supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl : "";
      return `
        <a href="post.html?id=${post.id}" class="post card" style="display:block;">
          <div class="post-header">
            <img class="avatar" width="36" height="36" src="${post.author.avatar_url || phAvatar(40)}" alt="">
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
