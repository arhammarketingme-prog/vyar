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
    .select("id, media_type, storage_path, text_content, background_color, created_at, tip_sticker_x, tip_sticker_y, visibility")
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

  root.style.background = story.media_type === "text" ? (story.background_color || "#f0a83a") : "black";
  content.innerHTML = `
    <div class="story-progress-row">${progressBars}</div>
    <div class="story-header">
      <img class="avatar" width="36" height="36" src="${profile.avatar_url || phAvatar(32, profile.display_name || profile.username)}" alt="">
      <strong>${escapeHtml(profile.username)}</strong>${story.visibility === "close_friends" ? ` <span style="color:#2fa89a; font-size:11px;">💚 Close Friends</span>` : ""}
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

  await renderInteractiveStickers(story, profile);
}

async function renderInteractiveStickers(story, profile) {
  const { data: stickers } = await supabase
    .from("story_stickers")
    .select("id, story_id, type, x, y, config")
    .eq("story_id", story.id);
  if (!stickers || stickers.length === 0) return;

  const content = document.getElementById("story-content");
  const isOwner = profile.id === session.user.id;

  for (const sticker of stickers) {
    const wrap = document.createElement("div");
    wrap.style.cssText = `position:absolute; left:${sticker.x * 100}%; top:${sticker.y * 100}%; transform:translate(-50%,-50%); z-index:3; min-width:200px;`;
    wrap.addEventListener("click", (e) => e.stopPropagation());
    content.appendChild(wrap);

    if (isOwner) {
      await renderStickerResults(sticker, wrap);
    } else {
      await renderStickerInput(sticker, wrap, profile);
    }
  }
}

async function renderStickerResults(sticker, wrap) {
  const { data: responses } = await supabase.from("story_sticker_responses").select("response").eq("sticker_id", sticker.id);
  const box = (inner) => `<div style="background:rgba(0,0,0,0.6); border-radius:14px; padding:12px; color:white; text-align:center; font-size:13px;">${inner}</div>`;

  if (sticker.type === "poll") {
    const counts = [0, 0];
    (responses || []).forEach((r) => counts[r.response.option_index]++);
    const total = counts[0] + counts[1] || 1;
    wrap.innerHTML = box(`
      <strong>${escapeHtml(sticker.config.question)}</strong>
      ${sticker.config.options
        .map((opt, i) => `<div style="margin-top:6px;">${escapeHtml(opt)}: ${Math.round((counts[i] / total) * 100)}% (${counts[i]})</div>`)
        .join("")}
    `);
  } else if (sticker.type === "question") {
    wrap.innerHTML = box(`
      <strong>${escapeHtml(sticker.config.prompt)}</strong>
      <div class="muted" style="margin-top:6px;">${(responses || []).length} response(s) — check Messages</div>
    `);
  } else if (sticker.type === "slider") {
    const values = (responses || []).map((r) => r.response.value);
    const avg = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : "—";
    wrap.innerHTML = box(`${sticker.config.emoji} Average: ${avg} <span class="muted">(${values.length} responses)</span>`);
  } else if (sticker.type === "quiz") {
    const correctCount = (responses || []).filter((r) => r.response.correct).length;
    const total = (responses || []).length || 1;
    wrap.innerHTML = box(`
      <strong>${escapeHtml(sticker.config.question)}</strong>
      <div style="margin-top:6px;">${correctCount}/${total} got it right (${Math.round((correctCount / total) * 100)}%)</div>
    `);
  } else if (sticker.type === "countdown") {
    const remindCount = (responses || []).length;
    wrap.innerHTML = box(`⏳ ${escapeHtml(sticker.config.label)}<div class="muted" style="margin-top:6px;">${remindCount} people set a reminder</div>`);
  }
}

async function renderStickerInput(sticker, wrap, profile) {
  const { data: existing } = await supabase
    .from("story_sticker_responses")
    .select("response")
    .eq("sticker_id", sticker.id)
    .eq("viewer_id", session.user.id)
    .maybeSingle();

  const boxStyle = "background:rgba(0,0,0,0.55); border-radius:14px; padding:12px; color:white; text-align:center;";

  if (sticker.type === "poll") {
    if (existing) {
      wrap.innerHTML = `<div style="${boxStyle}"><strong>${escapeHtml(sticker.config.question)}</strong><div class="muted" style="margin-top:6px;">You voted: ${escapeHtml(sticker.config.options[existing.response.option_index])}</div></div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="${boxStyle}">
        <strong>${escapeHtml(sticker.config.question)}</strong>
        <div style="display:flex; gap:8px; margin-top:8px;">
          ${sticker.config.options.map((opt, i) => `<button data-vote="${i}" class="btn" style="width:auto; padding:8px 16px; font-size:13px;">${escapeHtml(opt)}</button>`).join("")}
        </div>
      </div>`;
    wrap.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabase.from("story_sticker_responses").insert({
          sticker_id: sticker.id,
          viewer_id: session.user.id,
          response: { option_index: parseInt(btn.dataset.vote, 10) },
        });
        renderStickerInput(sticker, wrap, profile);
      });
    });
  } else if (sticker.type === "question") {
    if (existing) {
      wrap.innerHTML = `<div style="${boxStyle}"><strong>${escapeHtml(sticker.config.prompt)}</strong><div class="muted" style="margin-top:6px;">You answered — thanks!</div></div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="${boxStyle}">
        <strong>${escapeHtml(sticker.config.prompt)}</strong>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <input type="text" data-question-input placeholder="Type your answer..." style="margin-bottom:0; flex:1;">
          <button data-question-submit class="btn" style="width:auto; padding:8px 14px;">➤</button>
        </div>
      </div>`;
    wrap.querySelector("[data-question-submit]").addEventListener("click", async () => {
      const input = wrap.querySelector("[data-question-input]");
      const text = input.value.trim();
      if (!text) return;
      await supabase.from("story_sticker_responses").insert({
        sticker_id: sticker.id,
        viewer_id: session.user.id,
        response: { text },
      });
      // Also land it in real DMs — same "one messaging system" pattern as story replies.
      await supabase.from("direct_messages").insert({
        sender_id: session.user.id,
        recipient_id: profile.id,
        content: `Answered "${sticker.config.prompt}": ${text}`,
      });
      renderStickerInput(sticker, wrap, profile);
    });
  } else if (sticker.type === "slider") {
    if (existing) {
      wrap.innerHTML = `<div style="${boxStyle}">${sticker.config.emoji} <span class="muted">You rated: ${existing.response.value}/5</span></div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="${boxStyle}">
        <div style="font-size:28px;">${sticker.config.emoji}</div>
        <div style="display:flex; gap:6px; justify-content:center; margin-top:8px;">
          ${[1, 2, 3, 4, 5].map((n) => `<button data-slide="${n}" class="btn btn-secondary" style="width:auto; padding:6px 10px; font-size:13px;">${n}</button>`).join("")}
        </div>
      </div>`;
    wrap.querySelectorAll("[data-slide]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await supabase.from("story_sticker_responses").insert({
          sticker_id: sticker.id,
          viewer_id: session.user.id,
          response: { value: parseInt(btn.dataset.slide, 10) },
        });
        renderStickerInput(sticker, wrap, profile);
      });
    });
  } else if (sticker.type === "quiz") {
    if (existing) {
      const wasCorrect = existing.response.correct;
      wrap.innerHTML = `<div style="${boxStyle}"><strong>${escapeHtml(sticker.config.question)}</strong><div style="margin-top:6px;">${wasCorrect ? "✅ Correct!" : "❌ Not quite — the answer was " + escapeHtml(sticker.config.options[sticker.config.correct_index])}</div></div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="${boxStyle}">
        <strong>${escapeHtml(sticker.config.question)}</strong>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; justify-content:center;">
          ${sticker.config.options.map((opt, i) => `<button data-quiz-answer="${i}" class="btn" style="width:auto; padding:8px 14px; font-size:13px;">${escapeHtml(opt)}</button>`).join("")}
        </div>
      </div>`;
    wrap.querySelectorAll("[data-quiz-answer]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const chosen = parseInt(btn.dataset.quizAnswer, 10);
        await supabase.from("story_sticker_responses").insert({
          sticker_id: sticker.id,
          viewer_id: session.user.id,
          response: { option_index: chosen, correct: chosen === sticker.config.correct_index },
        });
        renderStickerInput(sticker, wrap, profile);
      });
    });
  } else if (sticker.type === "countdown") {
    const target = new Date(sticker.config.target_time).getTime();
    const renderTimeLeft = () => {
      const diffMs = target - Date.now();
      if (diffMs <= 0) return "Ended";
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      return `${h}h ${m}m left`;
    };
    wrap.innerHTML = `
      <div style="${boxStyle}">
        <strong>⏳ ${escapeHtml(sticker.config.label)}</strong>
        <div class="countdown-timer" style="margin-top:6px; font-size:16px;">${renderTimeLeft()}</div>
        ${existing ? `<div class="muted" style="margin-top:6px;">🔔 Reminder set</div>` : `<button data-remind class="btn" style="width:auto; padding:6px 14px; font-size:13px; margin-top:8px;">🔔 Remind me</button>`}
      </div>`;
    const timerEl = wrap.querySelector(".countdown-timer");
    const interval = setInterval(() => {
      if (!document.body.contains(timerEl)) return clearInterval(interval);
      timerEl.textContent = renderTimeLeft();
    }, 60000);
    const remindBtn = wrap.querySelector("[data-remind]");
    if (remindBtn) {
      remindBtn.addEventListener("click", async () => {
        await supabase.from("story_sticker_responses").insert({
          sticker_id: sticker.id,
          viewer_id: session.user.id,
          response: { reminder: true },
        });
        renderStickerInput(sticker, wrap, profile);
      });
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
