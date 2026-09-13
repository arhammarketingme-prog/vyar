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
