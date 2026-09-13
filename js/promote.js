import { supabase, requireAuth, showError } from "./supabaseClient.js";

export async function initPromote() {
  const session = await requireAuth();
  if (!session) return;

  const postSelect = document.getElementById("promote-post-select");
  const { data: posts } = await supabase
    .from("posts")
    .select("id, caption, created_at")
    .eq("author_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!posts || posts.length === 0) {
    document.getElementById("promote-root").innerHTML = `<p class="muted">Post something first, then come back here to promote it.</p>`;
    return;
  }

  postSelect.innerHTML = posts
    .map((p) => `<option value="${p.id}">${escapeHtml((p.caption || "(no caption)").slice(0, 50))}</option>`)
    .join("");

  const form = document.getElementById("promote-form");
  const errEl = document.getElementById("promote-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");

    const budget = parseInt(form.budget.value, 10);
    if (!budget || budget <= 0) {
      showError(errEl, new Error("Enter a valid budget."));
      return;
    }

    const { error } = await supabase.from("campaigns").insert({
      advertiser_id: session.user.id,
      post_id: postSelect.value,
      objective: form.objective.value,
      budget_inr: budget,
      target_language: form.target_language.value.trim() || null,
      target_location: form.target_location.value.trim() || null,
    });

    if (error) {
      showError(errEl, error);
      return;
    }
    window.location.href = "ads-dashboard.html";
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
