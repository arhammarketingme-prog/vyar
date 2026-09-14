import { supabase, requireAuth, showError } from "./supabaseClient.js";

export async function initCreatePost() {
  const session = await requireAuth();
  if (!session) return;

  const form = document.getElementById("create-post-form");
  const errEl = document.getElementById("create-post-error");
  const fileInput = document.getElementById("media-input");
  const preview = document.getElementById("preview");
  const typeRadios = form.querySelectorAll('input[name="post_type"]');
  const productSelect = document.getElementById("product-select");
  const communitySelect = document.getElementById("community-select");

  const { data: myCommunities } = await supabase
    .from("community_members")
    .select("community:communities(id, name)")
    .eq("user_id", session.user.id);
  if (myCommunities && myCommunities.length > 0) {
    communitySelect.innerHTML =
      `<option value="">My profile (default)</option>` +
      myCommunities.map((m) => `<option value="${m.community.id}">${m.community.name}</option>`).join("");
  }

  const { data: myProducts } = await supabase
    .from("products")
    .select("id, name")
    .eq("owner_id", session.user.id)
    .eq("is_active", true);
  if (myProducts && myProducts.length > 0) {
    productSelect.innerHTML =
      `<option value="">None</option>` +
      myProducts.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  }

  typeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const isReel = radio.value === "reel" && radio.checked;
      if (isReel) {
        fileInput.accept = "video/*";
        fileInput.multiple = false;
      } else if (radio.checked) {
        fileInput.accept = "image/*";
        fileInput.multiple = true;
      }
      fileInput.value = "";
      preview.innerHTML = "";
    });
  });

  fileInput.addEventListener("change", () => {
    preview.innerHTML = "";
    Array.from(fileInput.files).forEach((file) => {
      const isVideo = file.type.startsWith("video");
      const el = document.createElement(isVideo ? "video" : "img");
      el.src = URL.createObjectURL(file);
      el.style.width = "100%";
      el.style.borderRadius = "12px";
      el.style.marginBottom = "8px";
      if (isVideo) {
        el.controls = true;
      }
      preview.appendChild(el);
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";

    try {
      const caption = form.caption.value.trim();
      const postType = form.querySelector('input[name="post_type"]:checked')?.value || "post";
      const files = Array.from(fileInput.files);
      if (files.length === 0) throw new Error(postType === "reel" ? "Add a video." : "Add at least one photo.");
      if (postType === "post" && files.length > 10) throw new Error("Max 10 items per post.");
      if (postType === "reel" && files.length > 1) throw new Error("A Reel is a single video.");
      if (postType === "reel" && !files[0].type.startsWith("video")) throw new Error("Reels must be a video file.");

      // 1. Create the post row first so we have an id for the storage path.
      const { data: post, error: postErr } = await supabase
        .from("posts")
        .insert({ author_id: session.user.id, caption, post_type: postType, community_id: communitySelect.value || null })
        .select()
        .single();
      if (postErr) throw postErr;

      // 2. Upload each file, then record it in post_media.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop();
        const path = `${session.user.id}/${post.id}/${i}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-media")
          .upload(path, file, { upsert: false, contentType: file.type });
        if (uploadErr) throw uploadErr;

        const { error: mediaErr } = await supabase.from("post_media").insert({
          post_id: post.id,
          storage_path: path,
          media_type: file.type.startsWith("video") ? "video" : "image",
          position: i,
          alt_text: i === 0 ? form.alt_text.value.trim() : null,
        });
        if (mediaErr) throw mediaErr;
      }

      // 3. Tag a product, if one was selected.
      if (productSelect.value) {
        await supabase.from("post_products").insert({ post_id: post.id, product_id: productSelect.value });
      }

      // 4. Extract #hashtags from the caption and link them.
      const tags = [...caption.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase());
      for (const tag of tags) {
        const { data: hashtag, error: tagErr } = await supabase
          .from("hashtags")
          .upsert({ tag }, { onConflict: "tag" })
          .select()
          .single();
        if (!tagErr && hashtag) {
          await supabase.from("post_hashtags").insert({ post_id: post.id, hashtag_id: hashtag.id });
        }
      }

      window.location.href = postType === "reel" ? "reels.html" : "feed.html";
    } catch (err) {
      showError(errEl, err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Share";
    }
  });
}
