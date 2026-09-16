import { supabase, requireAuth } from "./supabaseClient.js";

let adminId = null;

async function logAction(action, targetType, targetId, details) {
  await supabase.from("admin_audit_log").insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: String(targetId),
    details: details || null,
  });
}

export async function initAdminModeration() {
  const session = await requireAuth();
  if (!session) return;

  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).single();
  if (!me || !me.is_admin) {
    document.getElementById("admin-root").innerHTML = `<p class="muted">You don't have admin access.</p>`;
    return;
  }
  adminId = session.user.id;

  await loadReports();

  document.getElementById("verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = e.target.username.value.trim();
    const msgEl = document.getElementById("verify-msg");
    const { data: profile, error } = await supabase.from("profiles").select("id, is_verified").eq("username", username).single();
    if (error || !profile) {
      msgEl.textContent = "User not found.";
      return;
    }
    const { error: updateErr } = await supabase.from("profiles").update({ is_verified: !profile.is_verified }).eq("id", profile.id);
    msgEl.textContent = updateErr ? updateErr.message : `@${username} is now ${!profile.is_verified ? "verified ✓" : "unverified"}.`;
    if (!updateErr) await logAction(!profile.is_verified ? "verify_user" : "unverify_user", "user", profile.id, { username });
    e.target.reset();
  });

  document.getElementById("suspend-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = e.target.username.value.trim();
    const msgEl = document.getElementById("suspend-msg");
    const { data: profile, error } = await supabase.from("profiles").select("id, is_suspended").eq("username", username).single();
    if (error || !profile) {
      msgEl.textContent = "User not found.";
      return;
    }
    if (!profile.is_suspended && !confirm(`Suspend @${username}? Their content becomes invisible to everyone until unsuspended.`)) return;
    const { error: updateErr } = await supabase.from("profiles").update({ is_suspended: !profile.is_suspended }).eq("id", profile.id);
    msgEl.textContent = updateErr ? updateErr.message : `@${username} is now ${!profile.is_suspended ? "SUSPENDED" : "active again"}.`;
    if (!updateErr) await logAction(!profile.is_suspended ? "suspend_user" : "unsuspend_user", "user", profile.id, { username });
    e.target.reset();
  });
}

async function loadReports() {
  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, target_type, target_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(50);

  const list = document.getElementById("reports-list");
  if (error || !reports || reports.length === 0) {
    list.innerHTML = `<p class="muted">No reports.</p>`;
    return;
  }

  list.innerHTML = reports
    .map(
      (r) => `
      <div class="card">
        <strong>${escapeHtml(r.target_type)}</strong> reported for <strong>${escapeHtml(r.reason)}</strong>
        <div class="muted">by @${escapeHtml(r.reporter?.username || "unknown")} · ${new Date(r.created_at).toLocaleString()} · status: ${r.status}</div>
        ${r.target_type === "post" ? `<a href="post.html?id=${r.target_id}" style="color:var(--vyra-accent);">View post</a>` : ""}
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button data-review="${r.id}" class="btn btn-secondary" style="width:auto; padding:6px 12px; font-size:13px;">Mark reviewed</button>
          <button data-dismiss="${r.id}" class="btn btn-secondary" style="width:auto; padding:6px 12px; font-size:13px;">Dismiss</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-review]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await supabase.from("reports").update({ status: "reviewed" }).eq("id", btn.dataset.review);
      await logAction("review_report", "report", btn.dataset.review);
      loadReports();
    })
  );
  list.querySelectorAll("[data-dismiss]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await supabase.from("reports").update({ status: "dismissed" }).eq("id", btn.dataset.dismiss);
      await logAction("dismiss_report", "report", btn.dataset.dismiss);
      loadReports();
    })
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
