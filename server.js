// server.js — Main Express application entry point
// Serves the static frontend from /public and exposes the REST API under /api

"use strict";

const path = require("path");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { query, getPool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());                          // Allow requests from any origin (lock this down in prod)
app.use(express.json());                  // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));

// =============================================================================
//  BUDGET ROUTES
// =============================================================================

// GET /api/budgets — list all budgets with computed spending totals
app.get("/api/budgets", async (_req, res) => {
  try {
    const rows = await query(`
      SELECT
        b.id,
        b.name,
        b.total_amount,
        b.period,
        b.notes,
        b.created_at,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS total_spent,
        COALESCE(SUM(CASE WHEN t.type = 'savings' THEN t.amount ELSE 0 END), 0) AS total_saved,
        COALESCE(SUM(CASE WHEN t.type = 'investment' THEN t.amount ELSE 0 END), 0) AS total_invested,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS total_income
      FROM budgets b
      LEFT JOIN transactions t ON t.budget_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[GET /api/budgets]", err);
    res.status(500).json({ success: false, message: "Failed to retrieve budgets." });
  }
});

// POST /api/budgets — create a new budget
app.post("/api/budgets", async (req, res) => {
  const { name, total_amount, period, notes } = req.body;

  if (!name || total_amount === undefined || !period) {
    return res.status(400).json({
      success: false,
      message: "Fields required: name, total_amount, period",
    });
  }

  try {
    const result = await query(
      "INSERT INTO budgets (name, total_amount, period, notes) VALUES (?, ?, ?, ?)",
      [name.trim(), parseFloat(total_amount), period.trim(), notes || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error("[POST /api/budgets]", err);
    res.status(500).json({ success: false, message: "Failed to create budget." });
  }
});

// PUT /api/budgets/:id — update a budget
app.put("/api/budgets/:id", async (req, res) => {
  const { id } = req.params;
  const { name, total_amount, period, notes } = req.body;

  if (!name || total_amount === undefined || !period) {
    return res.status(400).json({
      success: false,
      message: "Fields required: name, total_amount, period",
    });
  }

  try {
    const result = await query(
      "UPDATE budgets SET name = ?, total_amount = ?, period = ?, notes = ? WHERE id = ?",
      [name.trim(), parseFloat(total_amount), period.trim(), notes || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Budget not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/budgets/:id]", err);
    res.status(500).json({ success: false, message: "Failed to update budget." });
  }
});

// DELETE /api/budgets/:id — remove a budget (transactions become unlinked via FK SET NULL)
app.delete("/api/budgets/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query("DELETE FROM budgets WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Budget not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/budgets/:id]", err);
    res.status(500).json({ success: false, message: "Failed to delete budget." });
  }
});

// =============================================================================
//  TRANSACTION ROUTES
// =============================================================================

// GET /api/transactions — list transactions with optional filters
// Query params: type, category, budget_id, limit (default 100)
app.get("/api/transactions", async (req, res) => {
  try {
    const { type, category, budget_id } = req.query;
    const limit = parseInt(req.query.limit, 10) || 100;

    let sql = `
      SELECT
        t.id, t.budget_id, t.description, t.amount, t.type,
        t.category, t.transaction_date, t.reference, t.notes,
        t.created_at, t.updated_at,
        b.name AS budget_name
      FROM transactions t
      LEFT JOIN budgets b ON b.id = t.budget_id
      WHERE 1=1
    `;
    const params = [];

    if (type)      { sql += " AND t.type = ?";      params.push(type); }
    if (category)  { sql += " AND t.category = ?";  params.push(category); }
    if (budget_id) { sql += " AND t.budget_id = ?"; params.push(budget_id); }

    // Since 'limit' is strictly parsed as an integer, it is safe to interpolate directly
    sql += ` ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT ${limit}`;

    const rows = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("[GET /api/transactions]", err);
    res.status(500).json({ success: false, message: "Failed to retrieve transactions." });
  }
});

// GET /api/transactions/:id — single transaction
app.get("/api/transactions/:id", async (req, res) => {
  try {
    const rows = await query(
      `SELECT t.*, b.name AS budget_name
       FROM transactions t
       LEFT JOIN budgets b ON b.id = t.budget_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("[GET /api/transactions/:id]", err);
    res.status(500).json({ success: false, message: "Failed to retrieve transaction." });
  }
});

// POST /api/transactions — create a new transaction
app.post("/api/transactions", async (req, res) => {
  const { budget_id, description, amount, type, category, transaction_date, reference, notes } = req.body;

  if (!description || amount === undefined || !type || !category || !transaction_date) {
    return res.status(400).json({
      success: false,
      message: "Required: description, amount, type, category, transaction_date",
    });
  }

  const VALID_TYPES = ["income", "expense", "savings", "investment"];
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(", ")}` });
  }

  try {
    const result = await query(
      `INSERT INTO transactions
         (budget_id, description, amount, type, category, transaction_date, reference, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        budget_id || null,
        description.trim(),
        parseFloat(amount),
        type,
        category,
        transaction_date,
        reference?.trim() || null,
        notes?.trim() || null,
      ]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error("[POST /api/transactions]", err);
    res.status(500).json({ success: false, message: "Failed to create transaction." });
  }
});

// PUT /api/transactions/:id — full update
app.put("/api/transactions/:id", async (req, res) => {
  const { id } = req.params;
  const { budget_id, description, amount, type, category, transaction_date, reference, notes } = req.body;

  if (!description || amount === undefined || !type || !category || !transaction_date) {
    return res.status(400).json({
      success: false,
      message: "Required: description, amount, type, category, transaction_date",
    });
  }

  try {
    const result = await query(
      `UPDATE transactions
       SET budget_id = ?, description = ?, amount = ?, type = ?,
           category = ?, transaction_date = ?, reference = ?, notes = ?
       WHERE id = ?`,
      [
        budget_id || null,
        description.trim(),
        parseFloat(amount),
        type,
        category,
        transaction_date,
        reference?.trim() || null,
        notes?.trim() || null,
        id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/transactions/:id]", err);
    res.status(500).json({ success: false, message: "Failed to update transaction." });
  }
});

// DELETE /api/transactions/:id
app.delete("/api/transactions/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query("DELETE FROM transactions WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/transactions/:id]", err);
    res.status(500).json({ success: false, message: "Failed to delete transaction." });
  }
});

// =============================================================================
//  DASHBOARD SUMMARY ROUTE
// =============================================================================

// GET /api/dashboard — aggregated KPIs for the dashboard hub
app.get("/api/dashboard", async (_req, res) => {
  try {
    // Global totals across all transactions
    const [totals] = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income'     THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense'    THEN amount ELSE 0 END), 0) AS total_spending,
        COALESCE(SUM(CASE WHEN type = 'savings'    THEN amount ELSE 0 END), 0) AS total_savings,
        COALESCE(SUM(CASE WHEN type = 'investment' THEN amount ELSE 0 END), 0) AS total_investments
      FROM transactions
    `);

    // Total allocated budget
    const [budgetRow] = await query(
      "SELECT COALESCE(SUM(total_amount), 0) AS total_budget FROM budgets"
    );

    // Spending by category (for breakdown chart)
    const categoryBreakdown = await query(`
      SELECT category, type,
             COALESCE(SUM(amount), 0) AS total
      FROM transactions
      GROUP BY category, type
      ORDER BY total DESC
    `);

    // Recent 5 transactions
    const recentTransactions = await query(`
      SELECT t.id, t.description, t.amount, t.type, t.category, t.transaction_date, b.name AS budget_name
      FROM transactions t
      LEFT JOIN budgets b ON b.id = t.budget_id
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        kpis: {
          total_budget:      parseFloat(budgetRow.total_budget),
          total_income:      parseFloat(totals.total_income),
          total_spending:    parseFloat(totals.total_spending),
          total_savings:     parseFloat(totals.total_savings),
          total_investments: parseFloat(totals.total_investments),
          net_balance:
            parseFloat(totals.total_income) - parseFloat(totals.total_spending),
          budget_utilisation:
            budgetRow.total_budget > 0
              ? (totals.total_spending / budgetRow.total_budget) * 100
              : 0,
        },
        category_breakdown: categoryBreakdown,
        recent_transactions: recentTransactions,
      },
    });
  } catch (err) {
    console.error("[GET /api/dashboard]", err);
    res.status(500).json({ success: false, message: "Failed to load dashboard data." });
  }
});

// ─── 404 handler for unknown API routes ──────────────────────────────────────
app.use("/api/*", (_req, res) => {
  res.status(404).json({ success: false, message: "API route not found." });
});

// ─── Catch-all: serve the SPA for any non-API route ──────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[Unhandled Error]", err);
  res.status(500).json({ success: false, message: "An unexpected error occurred." });
});

// =============================================================================
//  START SERVER — warm up the DB connection pool before accepting traffic
// =============================================================================
(async () => {
  try {
    await getPool(); // Eagerly initialise pool + verify DB connectivity
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n✅  Finance Tracker API running on http://0.0.0.0:${PORT}`);
      console.log(`   Health check → http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error("❌  Failed to start server:", err.message);
    process.exit(1);
  }
})();
