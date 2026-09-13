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

  // Live updates: subscribe to new messages either direction between these two users.
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
      }
    )
    .subscribe();

  const form = document.getElementById("chat-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = form.content.value.trim();
    if (!content) return;
    form.content.value = "";
    await supabase.from("direct_messages").insert({
      sender_id: session.user.id,
      recipient_id: otherUserId,
      content,
    });
    // Realtime subscription above will render it — no need to render twice.
  });
}

async function loadMessages(myId, otherUserId) {
  const { data: messages } = await supabase
    .from("direct_messages")
    .select("id, sender_id, content, created_at")
    .or(
      `and(sender_id.eq.${myId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${myId})`
    )
    .order("created_at", { ascending: true });

  const list = document.getElementById("messages-list");
  list.innerHTML = "";
  (messages || []).forEach((m) => appendMessage(m, myId));
}

function appendMessage(m, myId) {
  const list = document.getElementById("messages-list");
  const isMine = m.sender_id === myId;
  const bubble = document.createElement("div");
  bubble.style.cssText = `
    max-width: 75%;
    margin: 4px 0;
    padding: 8px 12px;
    border-radius: 14px;
    ${isMine ? "margin-left:auto; background:var(--vyra-accent); color:white;" : "background:var(--vyra-surface); border:1px solid var(--vyra-border);"}
  `;
  bubble.textContent = m.content;
  list.appendChild(bubble);
  list.scrollTop = list.scrollHeight;
}
