import { supabase, requireAuth } from "./supabaseClient.js";

export async function initAnalytics() {
  const session = await requireAuth();
  if (!session) return;

  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", session.user.id).single();
  if (!me || !me.is_admin) {
    document.getElementById("analytics-root").innerHTML = `<p class="muted">You don't have admin access. Ask whoever administers the database to run: <code>update profiles set is_admin = true where username = 'yourusername';</code></p>`;
    return;
  }

  const countOf = async (table, filter) => {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) query = filter(query);
    const { count } = await query;
    return count || 0;
  };

  const [
    totalUsers,
    businessAccounts,
    totalPosts,
    totalReels,
    totalStories,
    totalComments,
    totalLikes,
    totalCommunities,
    totalProducts,
    activeCampaigns,
    pendingCampaigns,
  ] = await Promise.all([
    countOf("profiles"),
    countOf("profiles", (q) => q.eq("account_type", "business")),
    countOf("posts", (q) => q.eq("post_type", "post")),
    countOf("posts", (q) => q.eq("post_type", "reel")),
    countOf("stories"),
    countOf("comments"),
    countOf("likes"),
    countOf("communities"),
    countOf("products"),
    countOf("campaigns", (q) => q.eq("status", "active")),
    countOf("campaigns", (q) => q.eq("status", "pending_review")),
  ]);

  const { count: totalImpressions } = await supabase.from("ad_impressions").select("*", { count: "exact", head: true });
  const { count: totalClicks } = await supabase.from("ad_clicks").select("*", { count: "exact", head: true });

  const { data: earnings } = await supabase.from("creator_earnings").select("amount_inr, status");
  const earningsTotal = (earnings || []).reduce((sum, e) => sum + e.amount_inr, 0);

  document.getElementById("analytics-root").innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><strong>${totalUsers}</strong><div class="muted">Total Users</div></div>
      <div class="stat-box"><strong>${businessAccounts}</strong><div class="muted">Business Accounts</div></div>
      <div class="stat-box"><strong>${totalPosts}</strong><div class="muted">Photo Posts</div></div>
      <div class="stat-box"><strong>${totalReels}</strong><div class="muted">Reels</div></div>
      <div class="stat-box"><strong>${totalStories}</strong><div class="muted">Stories (all-time)</div></div>
      <div class="stat-box"><strong>${totalComments}</strong><div class="muted">Comments</div></div>
      <div class="stat-box"><strong>${totalLikes}</strong><div class="muted">Likes</div></div>
      <div class="stat-box"><strong>${totalCommunities}</strong><div class="muted">Communities</div></div>
      <div class="stat-box"><strong>${totalProducts}</strong><div class="muted">Products listed</div></div>
    </div>
    <h3>Advertising</h3>
    <div class="stat-grid">
      <div class="stat-box"><strong>${activeCampaigns}</strong><div class="muted">Active Campaigns</div></div>
      <div class="stat-box"><strong>${pendingCampaigns}</strong><div class="muted">Pending Review</div></div>
      <div class="stat-box"><strong>${totalImpressions || 0}</strong><div class="muted">Total Impressions</div></div>
      <div class="stat-box"><strong>${totalClicks || 0}</strong><div class="muted">Total Clicks</div></div>
    </div>
    <h3>Creator Earnings (ledger, not real payouts)</h3>
    <div class="stat-grid">
      <div class="stat-box"><strong>₹${earningsTotal}</strong><div class="muted">Total recorded</div></div>
    </div>
  `;
}
