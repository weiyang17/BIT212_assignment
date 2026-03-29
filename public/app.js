/**
 * app.js — FinanceCore Frontend
 * Communicates with the Express API over fetch().
 * No external libraries — pure Vanilla JS ES2020+.
 */

"use strict";

// ─── Configuration ────────────────────────────────────────────────────────────
// When served from the same EC2 origin the API base is just '/api'.
// Set window.API_BASE in a config script to override for local dev proxying.
const API = window.API_BASE || "/api";

// ─── State ────────────────────────────────────────────────────────────────────
let budgets = [];       // Cached budget list (for dropdowns & budget table)
let transactions = [];  // Cached transaction list

// ─── Utility helpers ──────────────────────────────────────────────────────────

/** Format a number as MYR currency with 2 decimal places */
function fmtMyr(val) {
  const n = parseFloat(val) || 0;
  return "RM " + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format an ISO date string to DD MMM YYYY */
function fmtDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Return today's date as YYYY-MM-DD for <input type="date"> */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Show / hide a modal */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.setAttribute("aria-hidden", "false"); el.classList.add("open"); }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.setAttribute("aria-hidden", "true"); el.classList.remove("open"); }
}

/** Show a toast message  type: 'success' | 'error' | 'info' */
function toast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = "slideOutToast .25s ease forwards";
    el.addEventListener("animationend", () => el.remove());
  }, 3500);
}

/** Simple fetch wrapper — returns parsed JSON or throws */
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || `HTTP ${res.status}`);
  }
  return json;
}

// Type → display label, colour class, icon
const TYPE_META = {
  income:     { label: "Income",     cls: "income",     icon: "↑", color: "var(--green)" },
  expense:    { label: "Expense",    cls: "expense",    icon: "↓", color: "var(--red)" },
  savings:    { label: "Savings",    cls: "savings",    icon: "⬡", color: "var(--blue)" },
  investment: { label: "Investment", cls: "investment", icon: "◈", color: "var(--purple)" },
};

const CATEGORY_COLORS = [
  "var(--accent)", "var(--green)", "var(--blue)", "var(--purple)",
  "var(--red)", "#f472b6", "#34d399", "#fb923c", "#a3e635", "#38bdf8",
];

// ═════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

function switchView(viewName) {
  // Hide all views
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  // Show target view
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add("active");

  // Highlight nav item
  const navBtn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (navBtn) navBtn.classList.add("active");

  // Update page title
  const titles = { dashboard: "Dashboard", transactions: "Transactions", budgets: "Budgets" };
  document.getElementById("pageTitle").textContent = titles[viewName] || viewName;

  // Update topbar action button label
  const topBtn = document.getElementById("topbarActionBtn");
  if (viewName === "budgets") {
    topBtn.textContent = "+ New Budget";
    topBtn.onclick = () => openTransactionModal();  // overridden below
    topBtn.onclick = () => openBudgetModal();
  } else {
    topBtn.textContent = "+ New Transaction";
    topBtn.onclick = () => openTransactionModal();
  }

  // Close sidebar on mobile
  if (window.innerWidth <= 900) {
    document.getElementById("sidebar").classList.remove("open");
  }

  // Refresh data for the active view
  if (viewName === "dashboard")    loadDashboard();
  if (viewName === "transactions") loadTransactions();
  if (viewName === "budgets")      loadBudgets();
}

// ═════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const { data } = await apiFetch("/dashboard");
    const { kpis, category_breakdown, recent_transactions } = data;

    // KPI values
    document.getElementById("kpi-budget").textContent    = fmtMyr(kpis.total_budget);
    document.getElementById("kpi-income").textContent    = fmtMyr(kpis.total_income);
    document.getElementById("kpi-spending").textContent  = fmtMyr(kpis.total_spending);
    document.getElementById("kpi-savings").textContent   = fmtMyr(kpis.total_savings + kpis.total_investments);

    const net = kpis.net_balance;
    const netEl = document.getElementById("kpi-net");
    netEl.textContent = fmtMyr(Math.abs(net));
    netEl.className = `kpi-value ${net >= 0 ? "amount-positive" : "amount-negative"}`;

    // Budget utilisation bar
    const pct = Math.min(kpis.budget_utilisation, 100);
    const rawPct = kpis.budget_utilisation;
    const bar = document.getElementById("utilisationBar");
    bar.style.width = pct + "%";
    bar.className = "progress-bar" + (rawPct >= 100 ? " over" : rawPct >= 80 ? " warn" : "");
    document.getElementById("utilisationPct").textContent = rawPct.toFixed(1) + "%";
    document.getElementById("util-spent").textContent     = fmtMyr(kpis.total_spending);
    document.getElementById("util-budget").textContent    = fmtMyr(kpis.total_budget);
    document.getElementById("util-remaining").textContent = fmtMyr(Math.max(kpis.total_budget - kpis.total_spending, 0));

    // Category breakdown
    renderBreakdown(category_breakdown);

    // Recent transactions
    renderRecentList(recent_transactions);

    // Update connection status
    setStatus("online");
  } catch (err) {
    console.error("[Dashboard]", err);
    toast("Failed to load dashboard: " + err.message, "error");
    setStatus("offline");
  }
}

function renderBreakdown(rows) {
  const el = document.getElementById("breakdownList");
  // Only expenses for the spending breakdown
  const expenses = rows.filter(r => r.type === "expense");
  const total = expenses.reduce((s, r) => s + parseFloat(r.total), 0);

  if (!expenses.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">◻</div><p>No expense data yet.</p></div>`;
    return;
  }

  el.innerHTML = expenses.map((r, i) => {
    const pct = total > 0 ? (parseFloat(r.total) / total) * 100 : 0;
    const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
    return `
      <div class="breakdown-row">
        <span class="breakdown-dot" style="background:${color}"></span>
        <span class="breakdown-label">${r.category}</span>
        <div class="breakdown-bar-wrap">
          <div class="breakdown-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
        </div>
        <span class="breakdown-amount">${fmtMyr(r.total)}</span>
      </div>`;
  }).join("");
}

function renderRecentList(rows) {
  const el = document.getElementById("recentList");
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⇄</div><p>No transactions yet.</p></div>`;
    return;
  }
  el.innerHTML = rows.map(r => {
    const meta = TYPE_META[r.type] || TYPE_META.expense;
    return `
      <div class="recent-row">
        <div class="recent-type-badge" style="background:color-mix(in srgb, ${meta.color} 15%, transparent)">
          <span style="color:${meta.color}">${meta.icon}</span>
        </div>
        <div class="recent-info">
          <div class="recent-desc" title="${escHtml(r.description)}">${escHtml(r.description)}</div>
          <div class="recent-date">${fmtDate(r.transaction_date)}</div>
        </div>
        <div class="recent-amount amount-${meta.cls}">${fmtMyr(r.amount)}</div>
      </div>`;
  }).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
//  TRANSACTIONS
// ═════════════════════════════════════════════════════════════════════════════

async function loadTransactions() {
  const type     = document.getElementById("filterType").value;
  const category = document.getElementById("filterCategory").value;
  let qs = new URLSearchParams();
  if (type)     qs.set("type", type);
  if (category) qs.set("category", category);

  const tbody = document.getElementById("transactionTableBody");
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Loading…</td></tr>`;

  try {
    const { data } = await apiFetch(`/transactions?${qs}`);
    transactions = data;
    renderTransactionTable(transactions);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:var(--red)">Error: ${err.message}</td></tr>`;
    toast("Failed to load transactions.", "error");
  }
}

function renderTransactionTable(rows) {
  const tbody = document.getElementById("transactionTableBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">⇄</div><p>No transactions found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const meta = TYPE_META[r.type] || { label: r.type, cls: r.type };
    const sign = (r.type === "income") ? "+" : "-";
    return `
      <tr>
        <td class="date-cell">${fmtDate(r.transaction_date)}</td>
        <td style="color:var(--text-primary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.description)}">${escHtml(r.description)}</td>
        <td><span class="category-tag">${escHtml(r.category)}</span></td>
        <td><span class="type-badge ${meta.cls}">${meta.label}</span></td>
        <td style="color:var(--text-muted);font-size:.78rem">${escHtml(r.budget_name || "—")}</td>
        <td class="col-amount amount-${meta.cls}">${sign}${fmtMyr(r.amount)}</td>
        <td class="col-actions">
          <button class="btn btn-icon edit"   onclick="editTransaction(${r.id})"   title="Edit">✎</button>
          <button class="btn btn-icon delete" onclick="confirmDeleteTransaction(${r.id})" title="Delete">✕</button>
        </td>
      </tr>`;
  }).join("");
}

// ── Transaction modal ─────────────────────────────────────────────────────────

async function openTransactionModal(id = null) {
  // Populate budget dropdown
  await ensureBudgetsLoaded();
  const budgetSel = document.getElementById("transBudget");
  budgetSel.innerHTML = `<option value="">None</option>` +
    budgets.map(b => `<option value="${b.id}">${escHtml(b.name)} (${escHtml(b.period)})</option>`).join("");

  const form = document.getElementById("transactionForm");
  form.reset();
  document.getElementById("transId").value = "";
  document.getElementById("transDate").value = todayStr();

  const title = document.getElementById("transModalTitle");
  const btn   = document.getElementById("transSubmitBtn");

  if (id) {
    // Edit mode — populate form
    title.textContent = "Edit Transaction";
    btn.textContent   = "Update Transaction";
    try {
      const { data: t } = await apiFetch(`/transactions/${id}`);
      document.getElementById("transId").value          = t.id;
      document.getElementById("transDescription").value = t.description;
      document.getElementById("transDate").value        = t.transaction_date?.slice(0, 10) || todayStr();
      document.getElementById("transType").value        = t.type;
      document.getElementById("transCategory").value    = t.category;
      document.getElementById("transAmount").value      = t.amount;
      document.getElementById("transBudget").value      = t.budget_id || "";
      document.getElementById("transReference").value   = t.reference || "";
      document.getElementById("transNotes").value       = t.notes || "";
    } catch (err) {
      toast("Could not load transaction: " + err.message, "error");
      return;
    }
  } else {
    title.textContent = "New Transaction";
    btn.textContent   = "Save Transaction";
  }

  openModal("transactionModal");
}

document.getElementById("transactionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("transId").value;

  const payload = {
    description:      document.getElementById("transDescription").value.trim(),
    transaction_date: document.getElementById("transDate").value,
    type:             document.getElementById("transType").value,
    category:         document.getElementById("transCategory").value,
    amount:           document.getElementById("transAmount").value,
    budget_id:        document.getElementById("transBudget").value || null,
    reference:        document.getElementById("transReference").value.trim(),
    notes:            document.getElementById("transNotes").value.trim(),
  };

  const btn = document.getElementById("transSubmitBtn");
  btn.disabled = true;
  btn.textContent = id ? "Updating…" : "Saving…";

  try {
    if (id) {
      await apiFetch(`/transactions/${id}`, { method: "PUT", body: payload });
      toast("Transaction updated.", "success");
    } else {
      await apiFetch("/transactions", { method: "POST", body: payload });
      toast("Transaction created.", "success");
    }
    closeModal("transactionModal");
    loadTransactions();
    loadDashboard();
  } catch (err) {
    toast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = id ? "Update Transaction" : "Save Transaction";
  }
});

async function editTransaction(id) {
  await openTransactionModal(id);
}

// Delete with confirmation
let pendingDeleteFn = null;

function confirmDeleteTransaction(id) {
  document.getElementById("confirmMessage").textContent =
    "Delete this transaction? This cannot be undone.";
  pendingDeleteFn = async () => {
    try {
      await apiFetch(`/transactions/${id}`, { method: "DELETE" });
      toast("Transaction deleted.", "success");
      loadTransactions();
      loadDashboard();
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  };
  openModal("confirmModal");
}

// ═════════════════════════════════════════════════════════════════════════════
//  BUDGETS
// ═════════════════════════════════════════════════════════════════════════════

async function loadBudgets() {
  const tbody = document.getElementById("budgetTableBody");
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Loading…</td></tr>`;
  try {
    const { data } = await apiFetch("/budgets");
    budgets = data;
    renderBudgetTable(budgets);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading" style="color:var(--red)">Error: ${err.message}</td></tr>`;
    toast("Failed to load budgets.", "error");
  }
}

function renderBudgetTable(rows) {
  const tbody = document.getElementById("budgetTableBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">◻</div><p>No budgets yet. Create one to get started.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(b => {
    const spent     = parseFloat(b.total_spent)  || 0;
    const allocated = parseFloat(b.total_amount) || 0;
    const remaining = Math.max(allocated - spent, 0);
    const pct       = allocated > 0 ? Math.min((spent / allocated) * 100, 100) : 0;
    const barClass  = pct >= 100 ? "var(--red)" : pct >= 80 ? "var(--accent)" : "var(--green)";

    return `
      <tr>
        <td style="color:var(--text-primary);font-weight:500">${escHtml(b.name)}</td>
        <td><span class="category-tag">${escHtml(b.period)}</span></td>
        <td class="col-amount">${fmtMyr(b.total_amount)}</td>
        <td class="col-amount amount-expense">${fmtMyr(spent)}</td>
        <td class="col-amount ${remaining > 0 ? "amount-positive" : "amount-negative"}">${fmtMyr(remaining)}</td>
        <td>
          <div class="mini-progress-wrap">
            <div class="mini-progress-track">
              <div class="mini-progress-fill" style="width:${pct.toFixed(1)}%;background:${barClass}"></div>
            </div>
            <div class="mini-progress-label">${pct.toFixed(1)}% used</div>
          </div>
        </td>
        <td class="col-actions">
          <button class="btn btn-icon edit"   onclick="editBudget(${b.id})"         title="Edit">✎</button>
          <button class="btn btn-icon delete" onclick="confirmDeleteBudget(${b.id})" title="Delete">✕</button>
        </td>
      </tr>`;
  }).join("");
}

// ── Budget modal ──────────────────────────────────────────────────────────────

function openBudgetModal(id = null) {
  const form  = document.getElementById("budgetForm");
  const title = document.getElementById("budgetModalTitle");
  const btn   = document.getElementById("budgetSubmitBtn");
  form.reset();
  document.getElementById("budgetId").value = "";

  if (id) {
    const b = budgets.find(x => x.id === id);
    if (!b) return;
    title.textContent = "Edit Budget";
    btn.textContent   = "Update Budget";
    document.getElementById("budgetId").value      = b.id;
    document.getElementById("budgetName").value    = b.name;
    document.getElementById("budgetPeriod").value  = b.period;
    document.getElementById("budgetAmount").value  = b.total_amount;
    document.getElementById("budgetNotes").value   = b.notes || "";
  } else {
    title.textContent = "New Budget";
    btn.textContent   = "Save Budget";
  }

  openModal("budgetModal");
}

async function editBudget(id) {
  // Ensure budgets are loaded (may be called from the table)
  if (!budgets.length) await loadBudgets();
  openBudgetModal(id);
}

document.getElementById("budgetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id  = document.getElementById("budgetId").value;
  const btn = document.getElementById("budgetSubmitBtn");

  const payload = {
    name:         document.getElementById("budgetName").value.trim(),
    total_amount: document.getElementById("budgetAmount").value,
    period:       document.getElementById("budgetPeriod").value.trim(),
    notes:        document.getElementById("budgetNotes").value.trim(),
  };

  btn.disabled    = true;
  btn.textContent = id ? "Updating…" : "Saving…";

  try {
    if (id) {
      await apiFetch(`/budgets/${id}`, { method: "PUT", body: payload });
      toast("Budget updated.", "success");
    } else {
      await apiFetch("/budgets", { method: "POST", body: payload });
      toast("Budget created.", "success");
    }
    closeModal("budgetModal");
    await loadBudgets();
  } catch (err) {
    toast("Error: " + err.message, "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = id ? "Update Budget" : "Save Budget";
  }
});

function confirmDeleteBudget(id) {
  document.getElementById("confirmMessage").textContent =
    "Delete this budget? Linked transactions will not be deleted but will become unlinked.";
  pendingDeleteFn = async () => {
    try {
      await apiFetch(`/budgets/${id}`, { method: "DELETE" });
      toast("Budget deleted.", "success");
      loadBudgets();
      loadDashboard();
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  };
  openModal("confirmModal");
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/** Ensure budget list is loaded (e.g. for dropdowns) */
async function ensureBudgetsLoaded() {
  if (!budgets.length) {
    try {
      const { data } = await apiFetch("/budgets");
      budgets = data;
    } catch (_) { /* ignore */ }
  }
}

/** Escape HTML for safe rendering */
function escHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Update the sidebar connection indicator */
function setStatus(state) {
  const dot   = document.querySelector(".status-dot");
  const label = document.querySelector(".status-label");
  if (state === "online") {
    dot.className   = "status-dot online";
    label.textContent = "Connected";
  } else {
    dot.className   = "status-dot offline";
    label.textContent = "Disconnected";
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═════════════════════════════════════════════════════════════════════════════

// Sidebar nav
document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// Mobile sidebar toggle
document.getElementById("menuToggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
});

// Close sidebar on overlay click (mobile)
document.addEventListener("click", (e) => {
  const sidebar = document.getElementById("sidebar");
  const toggle  = document.getElementById("menuToggle");
  if (sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) &&
      !toggle.contains(e.target)) {
    sidebar.classList.remove("open");
  }
});

// Topbar action button
document.getElementById("topbarActionBtn").addEventListener("click", () => openTransactionModal());

// Transaction view button
document.getElementById("newTransactionBtn").addEventListener("click", () => openTransactionModal());

// Budget view button
document.getElementById("newBudgetBtn").addEventListener("click", () => openBudgetModal());

// Transaction filters
document.getElementById("filterType").addEventListener("change",    loadTransactions);
document.getElementById("filterCategory").addEventListener("change", loadTransactions);

// Modal close buttons
document.getElementById("closeTransModal").addEventListener("click",   () => closeModal("transactionModal"));
document.getElementById("cancelTransModal").addEventListener("click",  () => closeModal("transactionModal"));
document.getElementById("closeBudgetModal").addEventListener("click",  () => closeModal("budgetModal"));
document.getElementById("cancelBudgetModal").addEventListener("click", () => closeModal("budgetModal"));
document.getElementById("closeConfirmModal").addEventListener("click", () => closeModal("confirmModal"));
document.getElementById("cancelConfirm").addEventListener("click",     () => closeModal("confirmModal"));

// Confirm delete
document.getElementById("confirmDelete").addEventListener("click", async () => {
  closeModal("confirmModal");
  if (typeof pendingDeleteFn === "function") {
    await pendingDeleteFn();
    pendingDeleteFn = null;
  }
});

// Close modals on overlay click
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
    }
  });
});

// Close modals on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.open").forEach(m => {
      m.classList.remove("open");
      m.setAttribute("aria-hidden", "true");
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  INIT
// ═════════════════════════════════════════════════════════════════════════════

(async function init() {
  // Set current date in topbar
  document.getElementById("currentDate").textContent =
    new Date().toLocaleDateString("en-MY", { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  // Load initial view
  await loadDashboard();
})();
