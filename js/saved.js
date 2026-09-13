import { supabase, requireAuth } from "./supabaseClient.js";

export async function initSaved() {
  const session = await requireAuth();
  if (!session) return;

  const { data: saved, error } = await supabase
    .from("saves")
    .select("post_id, posts(id, post_media(storage_path, position))")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  const grid = document.getElementById("saved-grid");
  if (error || !saved || saved.length === 0) {
    grid.innerHTML = `<p class="muted">Nothing saved yet — tap the 🔖 icon on any post to save it here.</p>`;
    return;
  }

  grid.innerHTML = "";
  saved.forEach((item) => {
    const post = item.posts;
    if (!post) return;
    const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
    if (!media) return;
    const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "100%";
    img.style.aspectRatio = "1";
    img.style.objectFit = "cover";
    img.style.cursor = "pointer";
    img.addEventListener("click", () => (window.location.href = `post.html?id=${post.id}`));
    grid.appendChild(img);
  });
}
