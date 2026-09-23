import { supabase, requireAuth, showError, uploadWithProgress } from "./supabaseClient.js";
import { getLang } from "./i18n.js";

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
      if (isVideo) el.controls = true;
      preview.appendChild(el);
    });
  });

  document.getElementById("ai-caption-btn").addEventListener("click", async () => {
    const btn = document.getElementById("ai-caption-btn");
    const description = prompt("Briefly describe what's in this post — helps write a better caption:", form.caption.value || "");
    if (description === null) return;
    btn.disabled = true;
    btn.textContent = "✨ Thinking...";
    try {
      const langNames = { en: "English", mr: "Marathi", hi: "Hindi", gu: "Gujarati", bn: "Bengali", pa: "Punjabi", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", or: "Odia", as: "Assamese" };
      const { data, error } = await supabase.functions.invoke("ai-caption", {
        body: { description, language: langNames[getLang()] || "English" },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "AI caption failed");
      const tags = (data.hashtags || []).map((t) => `#${t}`).join(" ");
      form.caption.value = tags ? `${data.caption}\n\n${tags}` : data.caption;
    } catch (err) {
      alert(err.message || "Couldn't generate a caption — please try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Suggest a caption";
    }
  });

  // Creates one post row, uploads its media, links a product and any
  // #hashtags in the caption. If the upload fails partway, the post row
  // is removed again so nothing broken is left behind.
  async function createAndUploadPost({ caption, postType, mediaFiles, communityId, productId, altText, onProgress }) {
    const { data: post, error: postErr } = await supabase
      .from("posts")
      .insert({ author_id: session.user.id, caption, post_type: postType, community_id: communityId })
      .select()
      .single();
    if (postErr) throw postErr;

    try {
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i];
        const ext = file.name.split(".").pop();
        const path = `${session.user.id}/${post.id}/${i}.${ext}`;

        await uploadWithProgress("post-media", path, file, session.access_token, onProgress || (() => {}));

        const { error: mediaErr } = await supabase.from("post_media").insert({
          post_id: post.id,
          storage_path: path,
          media_type: file.type.startsWith("video") ? "video" : "image",
          position: i,
          alt_text: i === 0 ? altText : null,
        });
        if (mediaErr) throw mediaErr;
      }

      if (productId) {
        await supabase.from("post_products").insert({ post_id: post.id, product_id: productId });
      }

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

      return post.id;
    } catch (err) {
      await supabase.from("posts").delete().eq("id", post.id);
      throw err;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Posting...";

    const caption = form.caption.value.trim();
    const postType = form.querySelector('input[name="post_type"]:checked')?.value || "post";
    const files = Array.from(fileInput.files);
    const communityId = communitySelect.value || null;
    const productId = productSelect.value || null;

    try {
      if (files.length === 0) throw new Error(postType === "reel" ? "Add a video." : "Add at least one photo.");
      if (postType === "post" && files.length > 10) throw new Error("Max 10 items per post.");
      if (postType === "reel" && files.length > 1) throw new Error("A Reel is a single video.");
      if (postType === "reel" && !files[0].type.startsWith("video")) throw new Error("Reels must be a video file.");

      const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp"];
      if (postType === "reel" && !SUPPORTED_VIDEO_TYPES.includes(files[0].type)) {
        throw new Error(
          `This video format (${files[0].type || "unknown"}) isn't supported by web browsers. ` +
          `Please convert it to MP4 first (most phones save in MP4 by default) and try again.`
        );
      }

      if (postType === "reel") {
        // Peek at duration first so we can warn about a long wait before
        // committing to it — better than surprising the user mid-way.
        const { getVideoDuration, splitReelInto1MinParts } = await import("./video-crop.js");
        const roughDuration = await getVideoDuration(files[0]).catch(() => 0);
        const roughParts = Math.max(1, Math.ceil(roughDuration / 60));
        if (roughParts > 1) {
          const estMinutes = Math.ceil(roughDuration / 60);
          const proceed = confirm(
            `This video is about ${estMinutes} minutes long and will be split into ${roughParts} separate Reels. ` +
            `Processing takes roughly as long as the video itself (~${estMinutes} min) — keep this tab open until it finishes.\n\nContinue?`
          );
          if (!proceed) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Share";
            return;
          }
        }

        // Reels are capped at 60 seconds. A longer upload is automatically
        // split into consecutive 60-second parts, each posted separately.
        const parts = await splitReelInto1MinParts(files[0], {
          onProgress: (partIndex, partCount, frac) => {
            const label = partCount > 1 ? `Part ${partIndex + 1}/${partCount}` : "Preparing video";
            submitBtn.textContent = `${label}... ${Math.round(frac * 100)}%`;
          },
        });
        if (parts.length === 0) throw new Error("Couldn't process this video — please try a different file.");

        for (let p = 0; p < parts.length; p++) {
          const partCaption = parts.length > 1 ? `${caption} (Part ${p + 1}/${parts.length})`.trim() : caption;
          submitBtn.textContent = parts.length > 1 ? `Uploading part ${p + 1}/${parts.length}... 0%` : "Uploading... 0%";
          await createAndUploadPost({
            caption: partCaption,
            postType: "reel",
            mediaFiles: [parts[p]],
            communityId,
            productId,
            altText: null,
            onProgress: (frac) => {
              const pct = Math.round(frac * 100);
              submitBtn.textContent = parts.length > 1
                ? `Uploading part ${p + 1}/${parts.length}... ${pct}%`
                : `Uploading... ${pct}%`;
            },
          });
        }
      } else {
        submitBtn.textContent = "Uploading... 0%";
        await createAndUploadPost({
          caption,
          postType: "post",
          mediaFiles: files,
          communityId,
          productId,
          altText: form.alt_text.value.trim(),
          onProgress: (frac) => { submitBtn.textContent = `Uploading... ${Math.round(frac * 100)}%`; },
        });
      }

      window.location.href = postType === "reel" ? "reels.html" : "feed.html";
    } catch (err) {
      showError(errEl, err);
      alert("Post failed: " + (err?.message || "Unknown error") + "\n\nPlease try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = "Share";
    }
  });
}
