import { supabase, requireAuth } from "./supabaseClient.js";

export async function initChat() {
  const session = await requireAuth();
  if (!session) return;

  const otherUserId = new URLSearchParams(window.location.search).get("u");
  if (!otherUserId) return;

  const { data: otherUser } = await supabase.from("profiles").select("username, avatar_url").eq("id", otherUserId).single();
  if (!otherUser) {
    document.getElementById("chat-header").textContent = "User not found.";
    return;
  }
  document.getElementById("chat-header").textContent = "@" + otherUser.username;

  await loadMessages(session.user.id, otherUserId);

  const vanishToggle = document.getElementById("vanish-toggle");

  // Live updates: subscribe to new + deleted messages either direction
  // between these two users. Deletes happen a few seconds after a
  // vanish-mode message is read.
  supabase
    .channel(`dm-${[session.user.id, otherUserId].sort().join("-")}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages" },
      (payload) => {
        const m = payload.new;
        const involvesUs =
          (m.sender_id === session.user.id && m.recipient_id === otherUserId) ||
          (m.sender_id === otherUserId && m.recipient_id === session.user.id);
        if (involvesUs) appendMessage(m, session.user.id);
        if (m.recipient_id === session.user.id) markRead(m.id);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "direct_messages" },
      (payload) => {
        const el = document.querySelector(`[data-message-id="${payload.old.id}"]`);
        if (el) el.remove();
      }
    )
    .subscribe();

  const form = document.getElementById("chat-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = form.content.value.trim();
    if (!content) return;
    form.content.value = "";
    const linkRisk = await scanForRisk(content);
    await supabase.from("direct_messages").insert({
      sender_id: session.user.id,
      recipient_id: otherUserId,
      content,
      vanish: vanishToggle.checked,
      link_risk: linkRisk,
    });
    // Realtime subscription above will render it — no need to render twice.
  });

  const imageInput = document.getElementById("chat-image-input");
  imageInput.addEventListener("change", async () => {
    const file = imageInput.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop();
    const path = `${session.user.id}/dm/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("post-media").upload(path, file, { contentType: file.type });
    if (uploadErr) {
      alert(uploadErr.message);
      return;
    }
    const mediaUrl = supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
    await supabase.from("direct_messages").insert({
      sender_id: session.user.id,
      recipient_id: otherUserId,
      content: "📷 Photo",
      media_url: mediaUrl,
      vanish: vanishToggle.checked,
    });
    imageInput.value = "";
  });
}

async function scanForRisk(text) {
  try {
    const { data } = await supabase.functions.invoke("scan-link", { body: { text } });
    return data?.risk || null;
  } catch {
    return null;
  }
}

async function markRead(messageId) {
  await supabase.from("direct_messages").update({ read_at: new Date().toISOString() }).eq("id", messageId).is("read_at", null);
}

async function loadMessages(myId, otherUserId) {
  const { data: messages } = await supabase
    .from("direct_messages")
    .select("id, sender_id, recipient_id, content, created_at, media_url, vanish, read_at, link_risk")
    .or(
      `and(sender_id.eq.${myId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${myId})`
    )
    .order("created_at", { ascending: true });

  const list = document.getElementById("messages-list");
  list.innerHTML = "";
  (messages || []).forEach((m) => appendMessage(m, myId));

  (messages || [])
    .filter((m) => m.recipient_id === myId && !m.read_at)
    .forEach((m) => markRead(m.id));
}

function appendMessage(m, myId) {
  const list = document.getElementById("messages-list");
  const isMine = m.sender_id === myId;
  const bubble = document.createElement("div");
  bubble.dataset.messageId = m.id;
  bubble.style.cssText = `
    max-width: 75%;
    margin: 4px 0;
    padding: 8px 12px;
    border-radius: 14px;
    ${isMine ? "margin-left:auto; background:var(--vyra-accent); color:white;" : "background:var(--vyra-surface); border:1px solid var(--vyra-border);"}
  `;
  if (m.media_url) {
    const img = document.createElement("img");
    img.src = m.media_url;
    img.style.cssText = "max-width:100%; border-radius:8px; display:block;";
    bubble.appendChild(img);
  } else {
    bubble.textContent = m.content;
  }
  if (m.link_risk && !isMine) {
    const warn = document.createElement("div");
    warn.textContent = m.link_risk === "dangerous"
      ? "⚠️ This message looks like a scam — don't open the link or share any details."
      : "⚠️ Unverified link — be careful before opening it.";
    warn.style.cssText = `font-size:11px; font-weight:700; margin-top:4px; color:${m.link_risk === "dangerous" ? "var(--vyra-rose)" : "var(--vyra-accent)"};`;
    bubble.appendChild(warn);
  }
  if (m.vanish) {
    const tag = document.createElement("div");
    tag.textContent = "🔥 Vanishes after read";
    tag.style.cssText = "font-size:10px; opacity:0.75; margin-top:2px;";
    bubble.appendChild(tag);
  }
  list.appendChild(bubble);
  list.scrollTop = list.scrollHeight;
}
