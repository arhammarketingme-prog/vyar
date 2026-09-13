import { supabase, requireAuth } from "./supabaseClient.js";

export async function initCollectionDetail() {
  const session = await requireAuth();
  if (!session) return;

  const collectionId = new URLSearchParams(window.location.search).get("id");
  if (!collectionId) return;

  const { data: collection, error: colErr } = await supabase
    .from("collections")
    .select("id, name, is_private, owner_id")
    .eq("id", collectionId)
    .single();

  if (colErr || !collection) {
    document.getElementById("collection-title").textContent = "Collection not found.";
    return;
  }

  document.getElementById("collection-title").textContent = collection.name;

  const { data: items, error } = await supabase
    .from("collection_items")
    .select("post_id, posts(id, post_media(storage_path, position))")
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false });

  const grid = document.getElementById("collection-grid");
  if (error || !items || items.length === 0) {
    grid.innerHTML = `<p class="muted">No posts in this collection yet.</p>`;
    return;
  }

  grid.innerHTML = "";
  items.forEach((item) => {
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
