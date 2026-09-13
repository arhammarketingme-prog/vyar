import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

let stories = [];
let currentIndex = 0;
let session = null;

export async function initStoryView() {
  session = await requireAuth();
  if (!session) return;

  const username = new URLSearchParams(window.location.search).get("u");
  if (!username) return;

  const { data: profile } = await supabase.from("profiles").select("id, username, avatar_url, upi_id").eq("username", username).single();
  if (!profile) {
    document.getElementById("story-root").textContent = "User not found.";
    return;
  }

  const { data, error } = await supabase
    .from("stories")
    .select("id, media_type, storage_path, text_content, background_color, created_at, tip_sticker_x, tip_sticker_y")
    .eq("author_id", profile.id)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    document.getElementById("story-root").textContent = "No active stories.";
    return;
  }

  stories = data;
  currentIndex = 0;
  renderStory(profile);

  document.getElementById("story-content").addEventListener("click", (e) => {
    const width = window.innerWidth;
    if (e.clientX < width / 2) goTo(currentIndex - 1, profile);
    else goTo(currentIndex + 1, profile);
  });

  const replyForm = document.getElementById("story-reply-form");
  if (profile.id !== session.user.id) {
    replyForm.style.display = "flex";
    replyForm.addEventListener("click", (e) => e.stopPropagation()); // don't advance the story while typing
    replyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = replyForm.reply.value.trim();
      if (!text) return;
      await supabase.from("direct_messages").insert({
        sender_id: session.user.id,
        recipient_id: profile.id,
        content: `Replied to your story: ${text}`,
      });
      replyForm.reply.value = "";
      replyForm.reply.placeholder = "Sent!";
      setTimeout(() => (replyForm.reply.placeholder = "Reply..."), 1500);
    });
  }
}

function goTo(index, profile) {
  if (index < 0) return;
  if (index >= stories.length) {
    window.location.href = "feed.html";
    return;
  }
  currentIndex = index;
  renderStory(profile);
}

async function renderStory(profile) {
  const story = stories[currentIndex];
  const root = document.getElementById("story-root");
  const content = document.getElementById("story-content");

  const progressBars = stories
    .map((_, i) => `<div class="story-progress-bar ${i < currentIndex ? "filled" : i === currentIndex ? "active" : ""}"></div>`)
    .join("");

  let mediaHtml = "";
  if (story.media_type === "image" && story.storage_path) {
    const url = supabase.storage.from("post-media").getPublicUrl(story.storage_path).data.publicUrl;
    mediaHtml = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
  }

  root.style.background = story.media_type === "text" ? (story.background_color || "#ff5d3b") : "black";
  content.innerHTML = `
    <div class="story-progress-row">${progressBars}</div>
    <div class="story-header">
      <img class="avatar" width="36" height="36" src="${profile.avatar_url || phAvatar(32)}" alt="">
      <strong>${escapeHtml(profile.username)}</strong>
    </div>
    ${mediaHtml}
    ${story.text_content ? `<div class="story-text">${escapeHtml(story.text_content)}</div>` : ""}
    ${
      story.tip_sticker_x != null && profile.upi_id
        ? `<button id="tip-sticker-btn-view" style="position:absolute; left:${story.tip_sticker_x * 100}%; top:${story.tip_sticker_y * 100}%; transform:translate(-50%,-50%); background:var(--vyra-accent); color:white; border:none; padding:10px 18px; border-radius:24px; font-weight:600; font-size:14px; z-index:3;">💰 Tip</button>`
        : ""
    }
  `;

  const tipBtn = document.getElementById("tip-sticker-btn-view");
  if (tipBtn) {
    tipBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (profile.id === session.user.id) return; // can't tip yourself
      const amountStr = prompt("Tip amount in ₹:");
      const amount = parseInt(amountStr, 10);
      if (!amount || amount <= 0) return;
      await supabase.from("tips").insert({ from_user_id: session.user.id, to_user_id: profile.id, amount_inr: amount });
      const payeeName = encodeURIComponent(profile.username);
      window.location.href = `upi://pay?pa=${encodeURIComponent(profile.upi_id)}&pn=${payeeName}&am=${amount}&cu=INR&tn=${encodeURIComponent("VYRA story tip")}`;
    });
  }

  // Log the view (id-only insert; RLS restricts to self as viewer).
  await supabase.from("story_views").upsert(
    { story_id: story.id, viewer_id: session.user.id },
    { onConflict: "story_id,viewer_id", ignoreDuplicates: true }
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
