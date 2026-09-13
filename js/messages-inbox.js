import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initMessagesInbox() {
  const session = await requireAuth();
  if (!session) return;

  const { data: messages, error } = await supabase
    .from("direct_messages")
    .select(`
      id, content, created_at, sender_id, recipient_id,
      sender:profiles!direct_messages_sender_id_fkey(username, avatar_url),
      recipient:profiles!direct_messages_recipient_id_fkey(username, avatar_url)
    `)
    .or(`sender_id.eq.${session.user.id},recipient_id.eq.${session.user.id}`)
    .order("created_at", { ascending: false })
    .limit(200);

  const list = document.getElementById("inbox-list");
  if (error || !messages || messages.length === 0) {
    list.innerHTML = `<p class="muted">No messages yet. Visit someone's profile to start a conversation.</p>`;
    return;
  }

  // Group by the other participant, keeping only the most recent message.
  const byPartner = new Map();
  for (const m of messages) {
    const isSender = m.sender_id === session.user.id;
    const partnerId = isSender ? m.recipient_id : m.sender_id;
    const partner = isSender ? m.recipient : m.sender;
    if (!byPartner.has(partnerId)) {
      byPartner.set(partnerId, { partner, lastMessage: m.content, at: m.created_at });
    }
  }

  list.innerHTML = [...byPartner.entries()]
    .map(
      ([partnerId, info]) => `
      <a href="chat.html?u=${partnerId}" class="search-result-row">
        <img class="avatar" width="36" height="36" src="${info.partner.avatar_url || phAvatar(40)}" alt="">
        <div>
          <strong>${escapeHtml(info.partner.username)}</strong>
          <div class="muted">${escapeHtml(info.lastMessage.slice(0, 40))}</div>
        </div>
      </a>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
