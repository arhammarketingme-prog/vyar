import { supabase, requireAuth, showError, phAvatar } from "./supabaseClient.js";

export async function initPostDetail() {
  const session = await requireAuth();
  if (!session) return;

  const postId = new URLSearchParams(window.location.search).get("id");
  if (!postId) return;

  const { data: post, error } = await supabase
    .from("posts")
    .select(`
      id, caption, created_at,
      author:profiles!posts_author_id_fkey ( id, username, avatar_url ),
      post_media ( storage_path, position, media_type ),
      post_products ( product:products ( id, name, price_inr, image_storage_path, external_url ) )
    `)
    .eq("id", postId)
    .single();

  if (error || !post) {
    document.getElementById("post-root").textContent = "Post not found or private.";
    return;
  }

  renderPost(post, session);
  renderTaggedProduct(post);
  await loadComments(postId);
  bindCommentForm(postId, session);
}

function renderTaggedProduct(post) {
  const tagged = post.post_products?.[0]?.product;
  if (!tagged) return;
  const el = document.getElementById("tagged-product");
  const imgUrl = tagged.image_storage_path
    ? supabase.storage.from("post-media").getPublicUrl(tagged.image_storage_path).data.publicUrl
    : phAvatar(50);

  el.innerHTML = `
    <div class="card" style="display:flex; gap:10px; align-items:center;">
      <img src="${imgUrl}" style="width:50px; height:50px; border-radius:8px; object-fit:cover;">
      <div style="flex:1;">
        <strong>${escapeHtml(tagged.name)}</strong> ${tagged.price_inr ? `· ₹${tagged.price_inr}` : ""}
      </div>
      <a href="#" id="buy-link" class="btn" style="width:auto; padding:8px 16px;">Buy</a>
    </div>
  `;
  document.getElementById("buy-link").addEventListener("click", async (e) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    await supabase.from("affiliate_events").insert({
      product_id: tagged.id,
      post_id: post.id,
      viewer_id: session.user.id,
    });
    window.open(tagged.external_url, "_blank");
  });
}

function renderPost(post, session) {
  const mediaList = (post.post_media || []).sort((a, b) => a.position - b.position);
  const isOwner = post.author.id === session.user.id;

  const items = mediaList
    .map((media) => {
      const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;
      return media.media_type === "video"
        ? `<video src="${url}" controls playsinline style="width:100%; flex-shrink:0; scroll-snap-align:start; border-radius:12px;"></video>`
        : `<img src="${url}" style="width:100%; flex-shrink:0; scroll-snap-align:start; border-radius:12px;">`;
    })
    .join("");
  const dots = mediaList.length > 1
    ? `<div style="text-align:center; margin-top:6px;">${mediaList.map(() => "●").join(" ")} <span class="muted" style="font-size:11px;">(swipe →)</span></div>`
    : "";

  document.getElementById("post-root").innerHTML = `
    <div class="card">
      <div class="post-header">
        <img class="avatar" width="36" height="36" src="${post.author.avatar_url || phAvatar(40)}" alt="">
        <strong>${escapeHtml(post.author.username)}</strong>
        <div style="margin-left:auto; display:flex; gap:8px;">
          ${isOwner ? `<button id="delete-post-btn" class="muted" style="background:none; border:none; cursor:pointer;">🗑️ Delete</button>` : `<button id="report-post-btn" class="muted" style="background:none; border:none; cursor:pointer;">🚩 Report</button>`}
        </div>
      </div>
      <div style="display:flex; overflow-x:auto; scroll-snap-type:x mandatory; gap:4px;">${items}</div>
      ${dots}
      <p>${linkifyCaption(post.caption || "")}</p>
      <div id="collection-picker-slot"></div>
    </div>
  `;

  if (isOwner) {
    document.getElementById("delete-post-btn").addEventListener("click", async () => {
      if (!confirm("Delete this post? This can't be undone.")) return;
      const { error } = await supabase.from("posts").delete().eq("id", post.id);
      if (!error) window.location.href = "profile.html";
    });
  } else {
    document.getElementById("report-post-btn").addEventListener("click", async () => {
      const reason = prompt("Why are you reporting this? (spam, harassment, hate_speech, nudity, violence, impersonation, other)");
      const validReasons = ["spam", "harassment", "hate_speech", "nudity", "violence", "impersonation", "other"];
      if (!reason || !validReasons.includes(reason.trim())) {
        alert("Please type one of: " + validReasons.join(", "));
        return;
      }
      const { error } = await supabase.from("reports").insert({
        reporter_id: session.user.id,
        target_type: "post",
        target_id: post.id,
        reason: reason.trim(),
      });
      alert(error ? error.message : "Reported. Thanks for flagging this.");
    });
  }

  renderCollectionPicker(post.id);
}

function linkifyCaption(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/@([a-zA-Z0-9_.]{3,30})/g, `<a href="profile.html?u=$1" style="color:var(--vyra-accent);">@$1</a>`)
    .replace(/#(\w+)/g, `<a href="hashtag.html?tag=$1" style="color:var(--vyra-accent);">#$1</a>`);
}

async function renderCollectionPicker(postId) {
  const slot = document.getElementById("collection-picker-slot");
  const { data: { session } } = await supabase.auth.getSession();
  const { data: collections } = await supabase
    .from("collections")
    .select("id, name")
    .eq("owner_id", session.user.id);

  const options = (collections || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  slot.innerHTML = `
    <div style="display:flex; gap:8px; margin-top:10px;">
      <select id="collection-select" style="margin-bottom:0;">
        <option value="">Save to collection...</option>
        ${options}
      </select>
      <button id="collection-add-btn" class="btn" style="width:auto;">Add</button>
    </div>
    <div id="collection-add-msg" class="muted"></div>
  `;

  document.getElementById("collection-add-btn").addEventListener("click", async () => {
    const collectionId = document.getElementById("collection-select").value;
    const msg = document.getElementById("collection-add-msg");
    if (!collectionId) {
      msg.textContent = "Pick a collection first (create one on the Collections page).";
      return;
    }
    const { error } = await supabase.from("collection_items").insert({ collection_id: collectionId, post_id: postId });
    msg.textContent = error ? error.message : "Added.";
  });
}

async function loadComments(postId) {
  const { data: comments, error } = await supabase
    .from("comments")
    .select(`id, content, created_at, author:profiles!comments_author_id_fkey ( username )`)
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error || !comments) return;

  const list = document.getElementById("comments-list");
  list.innerHTML = comments
    .map((c) => `<div class="card"><strong>${escapeHtml(c.author.username)}</strong> ${linkifyCaption(c.content)}</div>`)
    .join("");
}

function bindCommentForm(postId, session) {
  const form = document.getElementById("comment-form");
  const errEl = document.getElementById("comment-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = form.content.value.trim();
    if (!content) return;
    const { error } = await supabase.from("comments").insert({
      post_id: postId,
      author_id: session.user.id,
      content,
    });
    if (error) {
      showError(errEl, error);
      return;
    }
    form.content.value = "";
    await loadComments(postId);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
