import { supabase, requireAuth } from "./supabaseClient.js";

export async function initAuditLog() {
  const session = await requireAuth();
  if (!session) return;

  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).single();
  if (!me || !me.is_admin) {
    document.getElementById("audit-log-list").innerHTML = `<p class="muted">You don't have admin access.</p>`;
    return;
  }

  const { data: entries, error } = await supabase
    .from("admin_audit_log")
    .select("id, action, target_type, target_id, details, created_at, admin:profiles!admin_audit_log_admin_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(100);

  const list = document.getElementById("audit-log-list");
  if (error || !entries || entries.length === 0) {
    list.innerHTML = `<p class="muted">No admin actions logged yet.</p>`;
    return;
  }

  list.innerHTML = entries
    .map(
      (e) => `
      <div class="card">
        <strong>${escapeHtml(e.action)}</strong> on ${escapeHtml(e.target_type)} (${escapeHtml(e.target_id || "")})
        <div class="muted">by @${escapeHtml(e.admin?.username || "unknown")} · ${new Date(e.created_at).toLocaleString()}</div>
        ${e.details ? `<div class="muted">${escapeHtml(JSON.stringify(e.details))}</div>` : ""}
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
