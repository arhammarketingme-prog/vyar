import { supabase, requireAuth, showError } from "./supabaseClient.js";

let canvas, ctx;
let baseImage = null;       // Image object, or null for a pure color/text background
let currentFilter = "none";
let backgroundColor = "#ff5d3b";
let textItems = [];          // {text, x, y, color}
let stickerItems = [];       // {emoji, x, y}
let drawPaths = [];          // {points:[{x,y}], color}
let tipSticker = null;       // {x, y} — NOT baked into the image, stored separately
let activeItem = null;       // last placed text/sticker — tap-to-move target
let drawMode = false;
let tipStickerPlacementMode = false;
let currentDrawColor = "#ffffff";
let session = null;

const STICKERS = ["😀", "🔥", "❤️", "🎉", "👍", "😂", "✨", "📍"];

export async function initCreateStory() {
  session = await requireAuth();
  if (!session) return;

  canvas = document.getElementById("story-canvas");
  ctx = canvas.getContext("2d");
  render();

  const { data: profile } = await supabase.from("profiles").select("upi_id").eq("id", session.user.id).single();
  if (profile?.upi_id) {
    document.getElementById("tip-sticker-btn").classList.remove("hidden");
  }
  document.getElementById("tip-sticker-btn").addEventListener("click", () => {
    tipStickerPlacementMode = true;
    if (!tipSticker) tipSticker = { x: 0.5, y: 0.85 };
    positionTipMarker();
    document.getElementById("tip-sticker-marker").classList.remove("hidden");
    alert("Tap anywhere on the story to place the Tip button.");
  });

  document.getElementById("story-media-input").addEventListener("change", handleImageSelect);
  document.getElementById("add-text-btn").addEventListener("click", handleAddText);
  document.getElementById("draw-toggle-btn").addEventListener("click", toggleDrawMode);
  document.getElementById("draw-color-input").addEventListener("input", (e) => (currentDrawColor = e.target.value));

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-sticker]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = { emoji: btn.dataset.sticker, x: canvas.width / 2, y: canvas.height / 2 };
      stickerItems.push(item);
      activeItem = item;
      render();
    });
  });

  document.querySelectorAll("[data-bg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      backgroundColor = btn.dataset.bg;
      render();
    });
  });

  // Tap-to-move the most recently placed text/sticker, OR draw a stroke.
  let drawing = false;
  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDraw = (e) => {
    if (!drawMode) return;
    drawing = true;
    drawPaths.push({ points: [getPos(e)], color: currentDrawColor });
  };
  const moveDraw = (e) => {
    if (!drawing) return;
    drawPaths[drawPaths.length - 1].points.push(getPos(e));
    render();
  };
  const endDraw = () => (drawing = false);

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", moveDraw);
  canvas.addEventListener("mouseup", endDraw);
  canvas.addEventListener("touchstart", startDraw);
  canvas.addEventListener("touchmove", moveDraw);
  canvas.addEventListener("touchend", endDraw);

  canvas.addEventListener("click", (e) => {
    const pos = getPos(e);
    if (tipStickerPlacementMode) {
      tipSticker = { x: pos.x / canvas.width, y: pos.y / canvas.height };
      tipStickerPlacementMode = false;
      positionTipMarker();
      return;
    }
    if (drawMode || !activeItem) return;
    activeItem.x = pos.x;
    activeItem.y = pos.y;
    render();
  });

  document.getElementById("create-story-form").addEventListener("submit", handleSubmit);
}

function positionTipMarker() {
  if (!tipSticker) return;
  const marker = document.getElementById("tip-sticker-marker");
  marker.style.left = `${tipSticker.x * 100}%`;
  marker.style.top = `${tipSticker.y * 100}%`;
}

function handleImageSelect() {
  const file = document.getElementById("story-media-input").files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    baseImage = img;
    render();
  };
  img.src = URL.createObjectURL(file);
}

function handleAddText() {
  const text = prompt("Story text:");
  if (!text) return;
  const color = prompt("Text color (e.g. white, yellow, #ff0000):", "white") || "white";
  const item = { text, x: canvas.width / 2, y: canvas.height / 2, color };
  textItems.push(item);
  activeItem = item;
  render();
}

function toggleDrawMode() {
  drawMode = !drawMode;
  document.getElementById("draw-toggle-btn").textContent = drawMode ? "✏️ Drawing ON" : "✏️ Draw";
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (baseImage) {
    ctx.filter = currentFilter;
    // cover-fit the image into the canvas
    const scale = Math.max(canvas.width / baseImage.width, canvas.height / baseImage.height);
    const w = baseImage.width * scale;
    const h = baseImage.height * scale;
    ctx.drawImage(baseImage, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawPaths.forEach((path) => {
    ctx.strokeStyle = path.color;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    path.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  });

  stickerItems.forEach((s) => {
    ctx.font = "48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.emoji, s.x, s.y);
  });

  textItems.forEach((t) => {
    ctx.font = "bold 32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = t.color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("create-story-error");
  errEl.classList.add("hidden");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Posting...";

  try {
    // Flatten the whole canvas (image + filter + drawing + stickers + text)
    // into a single image — this is what gets uploaded and shown to viewers.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const path = `${session.user.id}/stories/${Date.now()}.png`;
    const { error: uploadErr } = await supabase.storage.from("post-media").upload(path, blob, { contentType: "image/png" });
    if (uploadErr) throw uploadErr;

    const { error: insertErr } = await supabase.from("stories").insert({
      author_id: session.user.id,
      media_type: "image",
      storage_path: path,
      tip_sticker_x: tipSticker?.x ?? null,
      tip_sticker_y: tipSticker?.y ?? null,
    });
    if (insertErr) throw insertErr;

    window.location.href = "feed.html";
  } catch (err) {
    showError(errEl, err);
    submitBtn.disabled = false;
    submitBtn.textContent = "Post Story";
  }
}
