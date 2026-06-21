const API_BASE = window.BORSA_GIDA_API_BASE || `${window.location.protocol}//${window.location.hostname}:8000/api`;

const countrySelect = document.getElementById("country");
const productSelect = document.getElementById("product");
const refDateInput = document.getElementById("ref-date");
const refreshBtn = document.getElementById("btn-refresh");
const errorBox = document.getElementById("error");
const backendStatus = document.getElementById("backend-status");
const todayDateEl = document.getElementById("today-date");
const rangePicker = document.getElementById("range-picker");
const rangeHint = document.getElementById("range-hint");

let chart = null;
let selectedDays = 30;
let countriesCache = [];
let currentTestRange = null;

const pageTitles = {
  dashboard: ["Tahmin Paneli", "Geçmiş fiyat verilerini analiz edin, geleceği tahmin edin"],
  products: ["Ürünler", "Ülke bazlı ürün ekleyin, fiyat güncelleyin veya kaldırın"],
  settings: ["Ülke Ayarları", "Para birimi ve model bilgilerini görüntüleyin/düzenleyin"],
};

function switchView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");

  document.querySelectorAll("#main-nav .nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });

  const [title, subtitle] = pageTitles[view];
  document.getElementById("page-title").textContent = title;
  document.getElementById("page-subtitle").textContent = subtitle;
  clearError();

  if (view === "products") loadProductList(document.getElementById("products-country").value);
  if (view === "settings") loadSettings(document.getElementById("settings-country").value);
}

function formatDate(isoDate) {
  if (!isoDate) return "-";
  const d = new Date(isoDate);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
}

function setBackendStatus(ok) {
  backendStatus.textContent = ok ? "Bağlı" : "Bağlanamadı";
  backendStatus.className = "badge " + (ok ? "badge-ok" : "badge-error");
}

async function loadCountries() {
  try {
    const res = await fetch(`${API_BASE}/countries`);
    if (!res.ok) throw new Error();
    const countries = await res.json();

    countriesCache = countries;

    [countrySelect, document.getElementById("products-country"), document.getElementById("settings-country")].forEach((sel) => {
      sel.innerHTML = "";
      countries.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.code;
        opt.textContent = c.label;
        sel.appendChild(opt);
      });
    });
    countrySelect.disabled = false;
    setBackendStatus(true);

    await loadProducts(countrySelect.value);
  } catch (err) {
    setBackendStatus(false);
    showError("Backend'e bağlanılamadı. Sunucunun çalıştığından emin olun (http://127.0.0.1:8000).");
  }
}

async function loadProducts(countryCode) {
  productSelect.disabled = true;
  productSelect.innerHTML = "<option>Yükleniyor...</option>";
  refDateInput.disabled = true;
  refreshBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/products/${countryCode}`);
    if (!res.ok) throw new Error();
    const products = await res.json();

    productSelect.innerHTML = "";
    products.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      productSelect.appendChild(opt);
    });
    productSelect.disabled = false;
    clearError();

    await loadTestRange();
  } catch (err) {
    showError("Ürün listesi yüklenemedi.");
  }
}

async function loadTestRange() {
  const country = countrySelect.value;
  const product = productSelect.value;
  if (!country || !product) return;

  try {
    const res = await fetch(`${API_BASE}/test_range/${country}/${encodeURIComponent(product)}`);
    if (!res.ok) throw new Error("Bu ürün için test dönemi verisi yok");
    const range = await res.json();
    currentTestRange = range;

    refDateInput.min = range.min_date;
    refDateInput.max = range.max_date;
    // 7 gunluk tahminin gercek degerle kiyaslanabilmesi icin son tarihten 7 gun once secili geliyor.
    const defaultDate = new Date(range.max_date);
    defaultDate.setDate(defaultDate.getDate() - 7);
    refDateInput.value = defaultDate.toISOString().slice(0, 10);
    refDateInput.disabled = false;
    refreshBtn.disabled = false;

    rangeHint.textContent = `Bu ürün için test dönemi: ${formatDate(range.min_date)} – ${formatDate(range.max_date)} (model bu tarihleri eğitimde görmedi)`;

    await updateDashboard();
  } catch (err) {
    refDateInput.disabled = true;
    refreshBtn.disabled = true;
    showError(err.message);
  }
}

async function updateDashboard() {
  clearError();
  const country = countrySelect.value;
  const product = productSelect.value;
  const refDate = refDateInput.value;
  if (!country || !product || !refDate) return;

  try {
    const [predictRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}/predict_at`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, product, date: refDate }),
      }),
      fetch(`${API_BASE}/history/${country}/${encodeURIComponent(product)}?days=${selectedDays}&end_date=${refDate}`),
    ]);

    if (!predictRes.ok) {
      const detail = await predictRes.json().catch(() => null);
      throw new Error(detail?.detail || "Tahmin alınamadı");
    }
    if (!historyRes.ok) throw new Error("Geçmiş veri alınamadı");

    const predictData = await predictRes.json();
    const historyData = await historyRes.json();

    renderStats(predictData);
    renderTable(predictData);
    renderChart(historyData, predictData);
  } catch (err) {
    showError(err.message);
  }
}

function renderStats(data) {
  const { "1d": d1, "7d": d7 } = data;

  document.getElementById("stat-current").textContent = `${data.current_price} ${data.currency}`;
  document.getElementById("stat-current-date").textContent = `Tarih: ${formatDate(data.date)}`;

  setStatChange("stat-1d", "stat-1d-change", data, d1);
  setStatChange("stat-7d", "stat-7d-change", data, d7);
}

function setStatChange(valueId, subId, base, d) {
  document.getElementById(valueId).textContent = `${d.predicted_price} ${base.currency}`;
  const el = document.getElementById(subId);

  if (d.actual_price === null) {
    el.textContent = `Gerçek değer henüz veri setinde yok · ${formatDate(d.target_date)}`;
    el.className = "stat-sub";
    return;
  }

  const error = d.predicted_price - d.actual_price;
  const errorPct = (error / d.actual_price) * 100;
  const sign = error >= 0 ? "+" : "";
  el.textContent = `Gerçek: ${d.actual_price} ${base.currency} · Hata: ${sign}${error.toFixed(2)} (${sign}${errorPct.toFixed(1)}%)`;
  el.className = "stat-sub " + (Math.abs(errorPct) <= 10 ? "positive" : "negative");
}

function renderTable(data) {
  const rows = [
    { label: "1 Gün Sonrası", d: data["1d"] },
    { label: "7 Gün Sonrası", d: data["7d"] },
  ];

  const body = document.getElementById("forecast-body");
  body.innerHTML = rows
    .map(({ label, d }) => {
      const hasActual = d.actual_price !== null;
      const error = hasActual ? d.predicted_price - d.actual_price : null;
      const errorPct = hasActual ? (error / d.actual_price) * 100 : null;
      const sign = hasActual && error >= 0 ? "+" : "";
      const cls = hasActual ? (Math.abs(errorPct) <= 10 ? "change-positive" : "change-negative") : "";
      const errorText = hasActual ? `${sign}${error.toFixed(2)} ${data.currency} (${sign}${errorPct.toFixed(1)}%)` : "-";
      const actualText = hasActual ? `${d.actual_price} ${data.currency}` : "Veri setinde yok";

      return `
        <tr>
          <td>${label}</td>
          <td>${formatDate(data.date)}</td>
          <td>${formatDate(d.target_date)}</td>
          <td>${data.current_price} ${data.currency}</td>
          <td>${d.predicted_price} ${data.currency}</td>
          <td>${actualText}</td>
          <td class="${cls}">${errorText}</td>
        </tr>
      `;
    })
    .join("");
}

function renderChart(history, predictData) {
  const labels = history.map((h) => formatDate(h.date));
  const prices = history.map((h) => h.price);

  const d1 = predictData["1d"];
  const d7 = predictData["7d"];

  const forecastLabels = [...labels, formatDate(d1.target_date), formatDate(d7.target_date)];
  const actualSeries = [...prices, d1.actual_price, d7.actual_price];
  const forecastSeries = new Array(prices.length - 1).fill(null).concat([
    prices[prices.length - 1],
    d1.predicted_price,
    d7.predicted_price,
  ]);

  if (chart) {
    chart.destroy();
  }

  const ctx = document.getElementById("priceChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: forecastLabels,
      datasets: [
        {
          label: "Gerçek Fiyat",
          data: actualSeries,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.12)",
          fill: true,
          tension: 0.25,
          pointRadius: (ctx) => (ctx.dataIndex >= prices.length ? 4 : 0),
          borderWidth: 2,
        },
        {
          label: "Tahmin",
          data: forecastSeries,
          borderColor: "#22c55e",
          borderDash: [6, 4],
          backgroundColor: "transparent",
          tension: 0,
          pointRadius: 4,
          pointBackgroundColor: "#22c55e",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#e6edf7" } },
      },
      scales: {
        x: {
          ticks: { color: "#8a97ab", maxTicksLimit: 10 },
          grid: { color: "#1f2c45" },
        },
        y: {
          ticks: { color: "#8a97ab" },
          grid: { color: "#1f2c45" },
        },
      },
    },
  });
}

function tickClock() {
  const now = new Date();
  todayDateEl.textContent = now.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ===================== ÜRÜNLER =====================

async function loadProductList(country) {
  const body = document.getElementById("product-list-body");
  body.innerHTML = `<tr><td colspan="5" class="muted">Yükleniyor...</td></tr>`;

  try {
    const res = await fetch(`${API_BASE}/admin/products/${country}`);
    if (!res.ok) throw new Error("Ürün listesi alınamadı");
    const products = await res.json();

    if (products.length === 0) {
      body.innerHTML = `<tr><td colspan="5" class="muted">Bu ülkede ürün yok.</td></tr>`;
      return;
    }

    body.innerHTML = products
      .map(
        (p) => `
        <tr>
          <td>${p.product}</td>
          <td>${formatDate(p.date)}</td>
          <td>
            <input type="number" step="0.01" value="${p.current_price}" data-product="${p.product}" class="price-input" style="width:100px" />
          </td>
          <td>
            <input type="date" data-product="${p.product}" class="date-input" />
          </td>
          <td class="row-actions">
            <button class="btn-mini" data-action="save" data-product="${p.product}">Kaydet</button>
            <button class="btn-mini danger" data-action="delete" data-product="${p.product}">Sil</button>
          </td>
        </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="muted">${err.message}</td></tr>`;
  }
}

document.getElementById("products-country").addEventListener("change", (e) => loadProductList(e.target.value));

document.getElementById("product-list-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const country = document.getElementById("products-country").value;
  const product = btn.dataset.product;

  if (btn.dataset.action === "delete") {
    if (!confirm(`"${product}" ürününü silmek istediğinize emin misiniz?`)) return;
    try {
      const res = await fetch(`${API_BASE}/admin/products/${country}/${encodeURIComponent(product)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Silme başarısız");
      await loadProductList(country);
      if (country === countrySelect.value) await loadProducts(country);
    } catch (err) {
      showError(err.message);
    }
  }

  if (btn.dataset.action === "save") {
    const row = btn.closest("tr");
    const price = Number(row.querySelector(".price-input").value);
    const dateValue = row.querySelector(".date-input").value;
    const payload = { current_price: price };
    if (dateValue) payload.date = dateValue;
    try {
      const res = await fetch(`${API_BASE}/admin/products/${country}/${encodeURIComponent(product)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Güncelleme başarısız");
      clearError();
      await loadProductList(country);
      if (country === countrySelect.value) await updateDashboard();
    } catch (err) {
      showError(err.message);
    }
  }
});

document.getElementById("product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const country = document.getElementById("products-country").value;
  const name = document.getElementById("pf-name").value.trim();
  const price = Number(document.getElementById("pf-price").value);
  const dateValue = document.getElementById("pf-date").value;
  const fuelRaw = document.getElementById("pf-fuel").value;

  const body = { product: name, current_price: price };
  if (dateValue) body.date = dateValue;
  if (fuelRaw) body.fuel_price = Number(fuelRaw);

  try {
    const res = await fetch(`${API_BASE}/admin/products/${country}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || "Ürün eklenemedi");
    }
    clearError();
    e.target.reset();
    await loadProductList(country);
    if (country === countrySelect.value) await loadProducts(country);
  } catch (err) {
    showError(err.message);
  }
});

// ===================== ÜLKE AYARLARI =====================

async function loadSettings(country) {
  try {
    const res = await fetch(`${API_BASE}/admin/settings/${country}`);
    if (!res.ok) throw new Error("Ayarlar alınamadı");
    const data = await res.json();

    document.getElementById("set-label").textContent = data.label;
    document.getElementById("set-count").textContent = data.product_count;
    document.getElementById("set-date").textContent = formatDate(data.last_data_date);
    document.getElementById("set-currency").value = data.currency;
  } catch (err) {
    showError(err.message);
  }
}

document.getElementById("settings-country").addEventListener("change", (e) => loadSettings(e.target.value));

document.getElementById("currency-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const country = document.getElementById("settings-country").value;
  const currency = document.getElementById("set-currency").value.trim();

  try {
    const res = await fetch(`${API_BASE}/admin/settings/${country}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency }),
    });
    if (!res.ok) throw new Error("Ayar kaydedilemedi");
    clearError();
    if (country === countrySelect.value) await updateDashboard();
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById("main-nav").addEventListener("click", (e) => {
  const item = e.target.closest(".nav-item");
  if (!item) return;
  switchView(item.dataset.view);
});

countrySelect.addEventListener("change", (e) => loadProducts(e.target.value));
productSelect.addEventListener("change", loadTestRange);
refDateInput.addEventListener("change", updateDashboard);
refreshBtn.addEventListener("click", updateDashboard);

rangePicker.addEventListener("click", (e) => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;

  rangePicker.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedDays = Number(btn.dataset.days);

  updateDashboard();
});

tickClock();
loadCountries();
