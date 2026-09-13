import { supabase, requireAuth } from "./supabaseClient.js";

export async function initAdsDashboard() {
  const session = await requireAuth();
  if (!session) return;

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, objective, budget_inr, status, target_language, target_location, created_at")
    .eq("advertiser_id", session.user.id)
    .order("created_at", { ascending: false });

  const list = document.getElementById("campaigns-list");
  if (error || !campaigns || campaigns.length === 0) {
    list.innerHTML = `<p class="muted">No campaigns yet. Promote a post to create your first one.</p>`;
    return;
  }

  for (const campaign of campaigns) {
    const [{ count: impressions }, { count: clicks }] = await Promise.all([
      supabase.from("ad_impressions").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id),
      supabase.from("ad_clicks").select("*", { count: "exact", head: true }).eq("campaign_id", campaign.id),
    ]);

    const ctr = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : "0.0";
    const statusLabel = {
      pending_review: "⏳ Pending review",
      active: "🟢 Active",
      paused: "⏸️ Paused",
      completed: "✅ Completed",
      rejected: "❌ Rejected",
    }[campaign.status];

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <strong>${escapeHtml(campaign.objective.replace(/_/g, " "))}</strong> · ${statusLabel}
      <div class="muted">Budget: ₹${campaign.budget_inr} · ${campaign.target_location || "No location target"} · ${campaign.target_language || "All languages"}</div>
      <div class="stat-grid" style="margin-top:10px;">
        <div class="stat-box"><strong>${impressions}</strong><div class="muted">Impressions</div></div>
        <div class="stat-box"><strong>${clicks}</strong><div class="muted">Clicks</div></div>
        <div class="stat-box"><strong>${ctr}%</strong><div class="muted">CTR</div></div>
      </div>
    `;
    list.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
