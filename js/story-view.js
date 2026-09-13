import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

let stories = [];
let currentIndex = 0;
let session = null;

export async function initStoryView() {
  session = await requireAuth();
  if (!session) return;

  const username = new URLSearchParams(window.location.search).get("u");
  if (!username) return;

  const { data: profile } = await supabase.from("profiles").select("id, username, avatar_url").eq("username", username).single();
  if (!profile) {
    document.getElementById("story-root").textContent = "User not found.";
    return;
  }

  const { data, error } = await supabase
    .from("stories")
    .select("id, media_type, storage_path, text_content, background_color, created_at")
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

  document.getElementById("story-root").addEventListener("click", (e) => {
    const width = window.innerWidth;
    if (e.clientX < width / 2) goTo(currentIndex - 1, profile);
    else goTo(currentIndex + 1, profile);
  });
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

  const progressBars = stories
    .map((_, i) => `<div class="story-progress-bar ${i < currentIndex ? "filled" : i === currentIndex ? "active" : ""}"></div>`)
    .join("");

  let mediaHtml = "";
  if (story.media_type === "image" && story.storage_path) {
    const url = supabase.storage.from("post-media").getPublicUrl(story.storage_path).data.publicUrl;
    mediaHtml = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
  }

  root.style.background = story.media_type === "text" ? (story.background_color || "#ff5d3b") : "black";
  root.innerHTML = `
    <div class="story-progress-row">${progressBars}</div>
    <div class="story-header">
      <img class="avatar" width="36" height="36" src="${profile.avatar_url || phAvatar(32)}" alt="">
      <strong>${escapeHtml(profile.username)}</strong>
    </div>
    ${mediaHtml}
    ${story.text_content ? `<div class="story-text">${escapeHtml(story.text_content)}</div>` : ""}
  `;

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
