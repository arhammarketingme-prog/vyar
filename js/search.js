import { supabase, requireAuth, phAvatar } from "./supabaseClient.js";

export async function initSearch() {
  const session = await requireAuth();
  if (!session) return;

  const input = document.getElementById("search-input");
  const usersEl = document.getElementById("search-users");
  const tagsEl = document.getElementById("search-tags");
  const businessEl = document.getElementById("search-business");

  // Pre-fill from ?q= (e.g. clicked in from a trending hashtag chip).
  const params = new URLSearchParams(window.location.search);
  const initial = params.get("q");
  if (initial) {
    input.value = initial;
    runSearch(initial, usersEl, tagsEl, businessEl);
  }

  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(input.value.trim(), usersEl, tagsEl, businessEl), 300);
  });
}

async function runSearch(query, usersEl, tagsEl, businessEl) {
  if (!query) {
    usersEl.innerHTML = "";
    tagsEl.innerHTML = "";
    businessEl.innerHTML = "";
    return;
  }

  const isHashtagQuery = query.startsWith("#");
  const cleanQuery = isHashtagQuery ? query.slice(1) : query;

  const [usersResult, tagsResult, businessResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, followers_count")
      .neq("account_type", "business")
      .ilike("username", `%${cleanQuery}%`)
      .limit(10),
    supabase
      .from("hashtags")
      .select("tag, post_count")
      .ilike("tag", `%${cleanQuery}%`)
      .order("post_count", { ascending: false })
      .limit(10),
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, business_category, location")
      .eq("account_type", "business")
      .or(`username.ilike.%${cleanQuery}%,business_category.ilike.%${cleanQuery}%,location.ilike.%${cleanQuery}%`)
      .limit(10),
  ]);

  renderUsers(usersResult.data || [], usersEl);
  renderTags(tagsResult.data || [], tagsEl);
  renderBusinesses(businessResult.data || [], businessEl);
}

function renderUsers(users, el) {
  if (users.length === 0) {
    el.innerHTML = `<p class="muted">No users found.</p>`;
    return;
  }
  el.innerHTML = users
    .map(
      (u) => `
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="search-result-row">
        <img class="avatar" width="36" height="36" src="${u.avatar_url || phAvatar(40, u.display_name || u.username)}" alt="">
        <div>
          <strong>${escapeHtml(u.username)}</strong>
          <div class="muted">${escapeHtml(u.display_name || "")} · ${u.followers_count} followers</div>
        </div>
      </a>`
    )
    .join("");
}

function renderTags(tags, el) {
  if (tags.length === 0) {
    el.innerHTML = `<p class="muted">No hashtags found.</p>`;
    return;
  }
  el.innerHTML = tags
    .map(
      (t) => `
      <a href="hashtag.html?tag=${encodeURIComponent(t.tag)}" class="search-result-row">
        <strong>#${escapeHtml(t.tag)}</strong>
        <span class="muted">${t.post_count} posts</span>
      </a>`
    )
    .join("");
}

function renderBusinesses(businesses, el) {
  if (businesses.length === 0) {
    el.innerHTML = `<p class="muted">No local businesses found.</p>`;
    return;
  }
  el.innerHTML = businesses
    .map(
      (b) => `
      <a href="profile.html?u=${encodeURIComponent(b.username)}" class="search-result-row">
        <img class="avatar" width="36" height="36" src="${b.avatar_url || phAvatar(40, b.display_name || b.username)}" alt="">
        <div>
          <strong>${escapeHtml(b.display_name || b.username)}</strong>
          <div class="muted">${escapeHtml(b.business_category || "")}${b.location ? " · " + escapeHtml(b.location) : ""}</div>
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
