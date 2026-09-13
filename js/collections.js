import { supabase, requireAuth, showError } from "./supabaseClient.js";

export async function initCollections() {
  const session = await requireAuth();
  if (!session) return;

  await loadCollections(session);

  const form = document.getElementById("new-collection-form");
  const errEl = document.getElementById("new-collection-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");
    const name = form.name.value.trim();
    const isPrivate = form.is_private.checked;
    if (!name) return;

    const { error } = await supabase.from("collections").insert({
      owner_id: session.user.id,
      name,
      is_private: isPrivate,
    });
    if (error) {
      showError(errEl, error);
      return;
    }
    form.reset();
    form.is_private.checked = true;
    await loadCollections(session);
  });
}

async function loadCollections(session) {
  const { data: collections, error } = await supabase
    .from("collections")
    .select("id, name, is_private, collection_items(count)")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false });

  const list = document.getElementById("collections-list");
  if (error || !collections || collections.length === 0) {
    list.innerHTML = `<p class="muted">No collections yet. Create one below, or add a saved post to a new collection from its post page.</p>`;
    return;
  }

  list.innerHTML = collections
    .map(
      (c) => `
      <a href="collection-detail.html?id=${c.id}" class="card" style="display:block;">
        <strong>${escapeHtml(c.name)}</strong>
        <span class="muted"> · ${c.is_private ? "Private" : "Public"} · ${c.collection_items[0]?.count || 0} items</span>
      </a>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
