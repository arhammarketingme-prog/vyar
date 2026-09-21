import { supabase, requireAuth, showError, phAvatar, verifiedBadge } from "./supabaseClient.js";
import { initHighlightsBar } from "./highlights.js";
import { t, translatePage } from "./i18n.js";

export async function initProfile() {
  const session = await requireAuth();
  if (!session) return;

  const params = new URLSearchParams(window.location.search);
  const username = params.get("u");

  const { data: profile, error } = username
    ? await supabase.from("profiles").select("*").eq("username", username).single()
    : await supabase.from("profiles").select("*").eq("id", session.user.id).single();

  if (error || !profile) {
    document.getElementById("profile-root").textContent = "Profile not found or private.";
    return;
  }

  const isOwnProfile = profile.id === session.user.id;
  renderProfile(profile, isOwnProfile, session);
  if (!isOwnProfile) {
    await renderFollowButton(profile, session);
    renderTipButton(profile, session);
    const slot = document.getElementById("follow-slot");
    const msgLink = document.createElement("a");
    msgLink.href = `chat.html?u=${profile.id}`;
    msgLink.className = "btn btn-secondary";
    msgLink.style.cssText = "display:inline-block; width:auto; padding:6px 14px; margin-top:8px;";
    msgLink.textContent = `💬 ${t("message_btn")}`;
    slot.appendChild(msgLink);
  }
  await renderPostsGrid(profile.id);
  await initHighlightsBar(profile.id, isOwnProfile);
}

function renderProfile(profile, isOwnProfile, session) {
  const root = document.getElementById("profile-root");
  root.innerHTML = `
    <div class="card" style="text-align:center;">
      <img class="avatar" width="80" height="80" style="width:80px;height:80px;" src="${profile.avatar_url || phAvatar(80, profile.display_name || profile.username)}" alt="">
      <h2>${escapeHtml(profile.display_name || profile.username)}${verifiedBadge(profile.is_verified)}</h2>
      <div class="muted">@${escapeHtml(profile.username)}</div>
      <p>${escapeHtml(profile.bio || "")}</p>
      ${profile.account_type === "business" ? `
        <div class="card" style="text-align:left; background:transparent; border-style:dashed;">
          ${profile.business_category ? `<div>🏷️ ${escapeHtml(profile.business_category)}</div>` : ""}
          ${profile.business_hours ? `<div>🕒 ${escapeHtml(profile.business_hours)}</div>` : ""}
          ${profile.contact_phone ? `<div>📞 ${escapeHtml(profile.contact_phone)}</div>` : ""}
        </div>
      ` : ""}
      <div style="display:flex; justify-content:center; gap:24px; margin:12px 0;">
        <div><strong>${profile.posts_count}</strong><div class="muted">${t("posts")}</div></div>
        <a href="follow-list.html?u=${encodeURIComponent(profile.username)}&type=followers" style="text-decoration:none; color:inherit;"><strong>${profile.followers_count}</strong><div class="muted">${t("followers")}</div></a>
        <a href="follow-list.html?u=${encodeURIComponent(profile.username)}&type=following" style="text-decoration:none; color:inherit;"><strong>${profile.following_count}</strong><div class="muted">${t("following_count")}</div></a>
      </div>
      <div id="follow-slot"></div>
      ${isOwnProfile ? `
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <a href="edit-profile.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">✏️ ${t("edit_profile")}</a>
          <a href="saved.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">🔖 ${t("saved")}</a>
          <a href="collections.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">📁 Collections</a>
          <a href="creator-studio.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">📊 Creator Studio</a>
          <a href="ads-dashboard.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">📢 Ads</a>
          <a href="products.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">🛍️ Products</a>
          <a href="analytics.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">📈 Analytics</a>
          <a href="security.html" class="btn btn-secondary" style="width:auto; padding:6px 14px; font-size:13px;">🔒 Security</a>
        </div>
      ` : ""}
      ${isOwnProfile ? `<button class="btn btn-secondary" id="logout-btn">${t("log_out")}</button>` : ""}
    </div>
    <div id="highlights-bar" class="story-bar"></div>
    <div id="posts-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:4px;"></div>
  `;

  if (isOwnProfile) {
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await supabase.auth.signOut({ scope: "local" });
      window.location.href = "login.html";
    });
  }
}

async function renderFollowButton(profile, session) {
  const slot = document.getElementById("follow-slot");
  const { data: existing } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_id", session.user.id)
    .eq("following_id", profile.id)
    .maybeSingle();

  const btn = document.createElement("button");
  btn.className = "btn";
  const setLabel = (state) => {
    btn.dataset.state = state || "none";
    if (state === "accepted") btn.textContent = t("unfollow");
    else if (state === "pending") btn.textContent = "Requested";
    else btn.textContent = t("follow");
  };
  setLabel(existing?.status);

  btn.addEventListener("click", async () => {
    if (btn.dataset.state === "none") {
      const status = profile.is_private ? "pending" : "accepted";
      await supabase.from("follows").insert({ follower_id: session.user.id, following_id: profile.id, status });
      setLabel(status);
    } else {
      // "Following" or "Requested" — either way, clicking again withdraws it.
      await supabase.from("follows").delete().eq("follower_id", session.user.id).eq("following_id", profile.id);
      setLabel(null);
    }
  });
  slot.appendChild(btn);

  // Block / Mute — lightweight, tucked below the main follow button.
  const modWrap = document.createElement("div");
  modWrap.style.cssText = "display:flex; gap:8px; margin-top:8px;";
  modWrap.innerHTML = `
    <button class="btn btn-secondary" id="mute-btn" style="width:auto; padding:6px 12px; font-size:13px;">🔇 Mute</button>
    <button class="btn btn-secondary" id="restrict-btn" style="width:auto; padding:6px 12px; font-size:13px;">🛡️ Restrict</button>
    <button class="btn btn-secondary" id="block-btn" style="width:auto; padding:6px 12px; font-size:13px;">🚫 Block</button>
  `;
  slot.appendChild(modWrap);

  const { data: existingRestrict } = await supabase.from("restricts").select("*").eq("restrictor_id", session.user.id).eq("restricted_id", profile.id).maybeSingle();
  const restrictBtn = document.getElementById("restrict-btn");
  if (existingRestrict) restrictBtn.textContent = "🛡️ Restricted ✓";
  restrictBtn.addEventListener("click", async () => {
    if (restrictBtn.textContent.includes("✓")) {
      await supabase.from("restricts").delete().eq("restrictor_id", session.user.id).eq("restricted_id", profile.id);
      restrictBtn.textContent = "🛡️ Restrict";
    } else {
      await supabase.from("restricts").insert({ restrictor_id: session.user.id, restricted_id: profile.id });
      restrictBtn.textContent = "🛡️ Restricted ✓";
    }
  });

  const { data: existingMute } = await supabase.from("mutes").select("*").eq("muter_id", session.user.id).eq("muted_id", profile.id).maybeSingle();
  const muteBtn = document.getElementById("mute-btn");
  if (existingMute) muteBtn.textContent = "🔇 Muted ✓";
  muteBtn.addEventListener("click", async () => {
    if (muteBtn.textContent.includes("✓")) {
      await supabase.from("mutes").delete().eq("muter_id", session.user.id).eq("muted_id", profile.id);
      muteBtn.textContent = "🔇 Mute";
    } else {
      await supabase.from("mutes").insert({ muter_id: session.user.id, muted_id: profile.id });
      muteBtn.textContent = "🔇 Muted ✓";
    }
  });

  document.getElementById("block-btn").addEventListener("click", async () => {
    if (!confirm(`Block @${profile.username}? They won't be able to see your posts or profile, and you won't see theirs.`)) return;
    await supabase.from("blocks").insert({ blocker_id: session.user.id, blocked_id: profile.id });
    window.location.href = "feed.html";
  });
}

async function renderTipButton(profile, session) {
  const slot = document.getElementById("follow-slot");
  const wrap = document.createElement("div");
  wrap.style.marginTop = "8px";

  if (profile.upi_id) {
    wrap.innerHTML = `
      <button class="btn btn-secondary" id="tip-btn">💰 Send a tip via UPI</button>
      <div id="tip-msg" class="muted"></div>
    `;
  } else {
    wrap.innerHTML = `<p class="muted">This creator hasn't added a UPI ID yet, so tipping isn't available.</p>`;
    slot.appendChild(wrap);
    return;
  }
  slot.appendChild(wrap);

  document.getElementById("tip-btn").addEventListener("click", async () => {
    const amountStr = prompt("Tip amount in ₹:");
    const amount = parseInt(amountStr, 10);
    const msgEl = document.getElementById("tip-msg");
    if (!amount || amount <= 0) {
      msgEl.textContent = "Enter a valid amount.";
      return;
    }

    // Build a UPI deep link — this opens the tipper's own UPI app
    // (GPay/PhonePe/Paytm) to complete a REAL payment directly to the
    // creator. VYRA never touches the money.
    const payeeName = encodeURIComponent(profile.display_name || profile.username);
    const upiLink = `upi://pay?pa=${encodeURIComponent(profile.upi_id)}&pn=${payeeName}&am=${amount}&cu=INR&tn=${encodeURIComponent("VYRA tip")}`;

    // Log the intent in our ledger regardless of whether payment completes —
    // this is a record of intent, not proof of payment.
    await supabase.from("tips").insert({
      from_user_id: session.user.id,
      to_user_id: profile.id,
      amount_inr: amount,
    });

    window.location.href = upiLink;
    msgEl.innerHTML = `Opening your UPI app for ₹${amount}... If nothing opens (e.g. on desktop), pay manually to <strong>${escapeHtml(profile.upi_id)}</strong>.`;
  });
}

async function renderPostsGrid(authorId) {
  const { data: posts, error } = await supabase
    .from("posts")
    .select("id, post_type, post_media(storage_path, position, media_type)")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false });

  if (error || !posts) return;

  const grid = document.getElementById("posts-grid");
  posts.forEach((post) => {
    const media = (post.post_media || []).sort((a, b) => a.position - b.position)[0];
    if (!media) return;
    const url = supabase.storage.from("post-media").getPublicUrl(media.storage_path).data.publicUrl;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative; width:100%; aspect-ratio:1; cursor:pointer;";

    const isVideo = media.media_type === "video";
    const el = document.createElement(isVideo ? "video" : "img");
    el.src = url;
    el.style.cssText = "width:100%; height:100%; object-fit:cover;";
    if (isVideo) el.muted = true;
    wrapper.appendChild(el);

    if (isVideo) {
      const badge = document.createElement("span");
      badge.textContent = "🎬";
      badge.style.cssText = "position:absolute; top:4px; right:4px; text-shadow:0 1px 3px rgba(0,0,0,0.8);";
      wrapper.appendChild(badge);
    }

    wrapper.addEventListener("click", () => (window.location.href = `post.html?id=${post.id}`));
    grid.appendChild(wrapper);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
