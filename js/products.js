import { supabase, requireAuth, showError, phAvatar } from "./supabaseClient.js";

export async function initProducts() {
  const session = await requireAuth();
  if (!session) return;

  await loadProducts(session);

  const form = document.getElementById("new-product-form");
  const errEl = document.getElementById("new-product-error");
  const fileInput = document.getElementById("product-image-input");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.classList.add("hidden");

    const name = form.name.value.trim();
    const price = parseInt(form.price.value, 10) || null;
    const externalUrl = form.external_url.value.trim();
    if (!name || !externalUrl) {
      showError(errEl, new Error("Name and a link to buy/order are required."));
      return;
    }

    let imagePath = null;
    const file = fileInput.files[0];
    if (file) {
      const ext = file.name.split(".").pop();
      imagePath = `${session.user.id}/products/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("post-media").upload(imagePath, file, { contentType: file.type });
      if (uploadErr) {
        showError(errEl, uploadErr);
        return;
      }
    }

    const { error } = await supabase.from("products").insert({
      owner_id: session.user.id,
      name,
      description: form.description.value.trim() || null,
      price_inr: price,
      external_url: externalUrl,
      image_storage_path: imagePath,
    });

    if (error) {
      showError(errEl, error);
      return;
    }
    form.reset();
    await loadProducts(session);
  });
}

async function loadProducts(session) {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, price_inr, image_storage_path, external_url, is_active")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false });

  const list = document.getElementById("products-list");
  if (error || !products || products.length === 0) {
    list.innerHTML = `<p class="muted">No products yet. Add one below — you'll be able to tag it on your posts.</p>`;
    return;
  }

  list.innerHTML = "";
  for (const p of products) {
    const url = p.image_storage_path
      ? supabase.storage.from("post-media").getPublicUrl(p.image_storage_path).data.publicUrl
      : phAvatar(60);
    const { count: clicks } = await supabase
      .from("affiliate_events")
      .select("*", { count: "exact", head: true })
      .eq("product_id", p.id);

    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "display:flex; gap:10px; align-items:center;";
    card.innerHTML = `
      <img src="${url}" style="width:50px; height:50px; border-radius:8px; object-fit:cover;">
      <div style="flex:1;">
        <strong>${escapeHtml(p.name)}</strong> ${p.price_inr ? `· ₹${p.price_inr}` : ""}
        <div class="muted">${p.is_active ? "Active" : "Inactive"} · ${clicks || 0} clicks</div>
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
