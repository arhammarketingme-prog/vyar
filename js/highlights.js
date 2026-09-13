import { supabase, requireAuth } from "./supabaseClient.js";

export async function initHighlightsBar(profileId, isOwnProfile) {
  const bar = document.getElementById("highlights-bar");
  if (!bar) return;

  if (isOwnProfile) {
    const addRing = document.createElement("div");
    addRing.style.textAlign = "center";
    addRing.innerHTML = `
      <a href="create-highlight.html" class="story-ring" style="display:flex; align-items:center; justify-content:center; background:var(--vyra-surface);">
        <span style="font-size:20px; color:var(--vyra-accent);">+</span>
      </a>
      <div class="story-label">New</div>
    `;
    bar.appendChild(addRing);
  }

  const { data: highlights } = await supabase
    .from("highlights")
    .select("id, title, cover_color")
    .eq("owner_id", profileId)
    .order("created_at", { ascending: false });

  (highlights || []).forEach((h) => {
    const ring = document.createElement("div");
    ring.style.textAlign = "center";
    ring.innerHTML = `
      <a href="highlight-view.html?id=${h.id}" class="story-ring" style="background:${h.cover_color}; display:flex; align-items:center; justify-content:center;">
        <span style="font-size:20px;">✨</span>
      </a>
      <div class="story-label">${escapeHtml(h.title)}</div>
    `;
    bar.appendChild(ring);
  });
}

export async function initCreateHighlight() {
  const session = await requireAuth();
  if (!session) return;

  const { data: myStories } = await supabase
    .from("stories")
    .select("id, storage_path, media_type, created_at")
    .eq("author_id", session.user.id)
    .order("created_at", { ascending: false });

  const grid = document.getElementById("story-picker-grid");
  if (!myStories || myStories.length === 0) {
    grid.innerHTML = `<p class="muted">Post a story first — you can turn it into a highlight anytime, even after it expires.</p>`;
    return;
  }

  const selected = new Set();
  grid.innerHTML = myStories
    .map((s) => {
      const url = s.storage_path
        ? supabase.storage.from("post-media").getPublicUrl(s.storage_path).data.publicUrl
        : "";
      return `<div class="story-pick" data-id="${s.id}" style="position:relative; cursor:pointer;">
        ${url ? `<img src="${url}" style="width:100%; aspect-ratio:9/16; object-fit:cover; border-radius:8px;">` : `<div style="width:100%; aspect-ratio:9/16; background:var(--vyra-surface); border-radius:8px;"></div>`}
        <div class="pick-check" style="position:absolute; top:4px; right:4px; width:20px; height:20px; border-radius:50%; border:2px solid white; background:transparent;"></div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".story-pick").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      const check = el.querySelector(".pick-check");
      if (selected.has(id)) {
        selected.delete(id);
        check.style.background = "transparent";
      } else {
        selected.add(id);
        check.style.background = "var(--vyra-accent)";
      }
    });
  });

  document.getElementById("create-highlight-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = e.target.title.value.trim();
    if (!title || selected.size === 0) {
      alert("Give it a name and pick at least one story.");
      return;
    }
    const { data: highlight, error } = await supabase
      .from("highlights")
      .insert({ owner_id: session.user.id, title })
      .select()
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    const items = [...selected].map((story_id, position) => ({ highlight_id: highlight.id, story_id, position }));
    await supabase.from("highlight_items").insert(items);
    window.location.href = "profile.html";
  });
}

export async function initHighlightView() {
  const session = await requireAuth();
  if (!session) return;

  const highlightId = new URLSearchParams(window.location.search).get("id");
  const { data: items } = await supabase
    .from("highlight_items")
    .select("position, story:stories(id, media_type, storage_path, text_content, background_color)")
    .eq("highlight_id", highlightId)
    .order("position", { ascending: true });

  const stories = (items || []).map((i) => i.story).filter(Boolean);
  if (stories.length === 0) {
    document.getElementById("story-root").textContent = "This highlight is empty.";
    return;
  }

  let index = 0;
  const root = document.getElementById("story-root");

  function render() {
    const s = stories[index];
    root.style.background = s.media_type === "text" ? s.background_color || "#ff5d3b" : "black";
    const mediaHtml =
      s.media_type === "image" && s.storage_path
        ? `<img src="${supabase.storage.from("post-media").getPublicUrl(s.storage_path).data.publicUrl}" style="width:100%; height:100%; object-fit:cover;">`
        : "";
    root.innerHTML = `
      <div class="story-progress-row">${stories.map((_, i) => `<div class="story-progress-bar ${i < index ? "filled" : i === index ? "active" : ""}"></div>`).join("")}</div>
      ${mediaHtml}
      ${s.text_content ? `<div class="story-text">${escapeHtml(s.text_content)}</div>` : ""}
    `;
  }

  root.addEventListener("click", (e) => {
    const goRight = e.clientX > window.innerWidth / 2;
    if (goRight) index++;
    else index--;
    if (index < 0) index = 0;
    if (index >= stories.length) {
      window.location.href = "profile.html";
      return;
    }
    render();
  });

  render();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
