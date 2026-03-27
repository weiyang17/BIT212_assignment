-- schema.sql
-- Run this script once against your RDS MySQL instance to initialise the schema.
-- Usage:  mysql -h <RDS_ENDPOINT> -u <USER> -p <DB_NAME> < schema.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BUDGETS
--    Each budget record represents a financial period (e.g. "Q3 2025 Operating")
--    with an allocated amount. Multiple budgets can coexist simultaneously.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
    id            INT             UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(120)    NOT NULL,
    total_amount  DECIMAL(15, 2)  NOT NULL DEFAULT 0.00,
    period        VARCHAR(50)     NOT NULL COMMENT 'e.g. 2025-Q3, FY2025, Monthly',
    notes         TEXT            NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Top-level budget allocations';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TRANSACTIONS
--    Core ledger.  Each row is a single financial event linked (optionally)
--    to a budget period.  The `type` column drives dashboard aggregation:
--      income      → adds to available balance
--      expense     → deducted from budget (operational spending tracked here)
--      savings     → ring-fenced funds, not counted as spending
--      investment  → capital deployment (fixed deposits, equities, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id            INT             UNSIGNED NOT NULL AUTO_INCREMENT,
    budget_id     INT             UNSIGNED NULL COMMENT 'FK to budgets.id — optional',
    description   VARCHAR(255)    NOT NULL,
    amount        DECIMAL(15, 2)  NOT NULL,
    type          ENUM(
                      'income',
                      'expense',
                      'savings',
                      'investment'
                  )               NOT NULL,
    category      ENUM(
                      'Operational Costs',
                      'Investments',
                      'Savings',
                      'Revenue',
                      'Payroll',
                      'Marketing',
                      'Technology',
                      'Fixed Deposits',
                      'Equities',
                      'Other'
                  )               NOT NULL DEFAULT 'Other',
    transaction_date  DATE        NOT NULL,
    reference     VARCHAR(100)    NULL  COMMENT 'Invoice / PO / cheque reference',
    notes         TEXT            NULL,
    created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_transactions_budget
        FOREIGN KEY (budget_id) REFERENCES budgets (id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,
    INDEX idx_type           (type),
    INDEX idx_category       (category),
    INDEX idx_transaction_date (transaction_date),
    INDEX idx_budget_id      (budget_id)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Individual financial transactions / ledger entries';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SEED DATA  (optional — remove in production)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO budgets (name, total_amount, period, notes) VALUES
    ('Q3 2025 Operations',  150000.00, '2025-Q3', 'Core operational budget'),
    ('FY2025 Investments',  500000.00, 'FY2025',  'Capital allocation for fixed assets and equities'),
    ('Emergency Reserve',    50000.00, 'Rolling', 'Maintain 3-month operational runway');

INSERT INTO transactions
    (budget_id, description, amount, type, category, transaction_date, reference, notes)
VALUES
    (1, 'Office Lease — July',        4500.00,  'expense',    'Operational Costs', '2025-07-01', 'INV-2025-0701', NULL),
    (1, 'Cloud Infrastructure (AWS)', 2300.00,  'expense',    'Technology',        '2025-07-03', 'AWS-JUL25',     'EC2 + RDS + S3'),
    (1, 'Payroll — July',            42000.00,  'expense',    'Payroll',           '2025-07-31', 'PAY-2025-07',   NULL),
    (1, 'Digital Marketing Campaign',  8500.00,  'expense',    'Marketing',         '2025-07-15', 'MKT-Q3-001',    NULL),
    (2, 'Fixed Deposit — Bank Simpanan', 100000.00, 'investment', 'Fixed Deposits', '2025-07-10', 'FD-BSN-2025',   '12-month tenure at 4.0% p.a.'),
    (2, 'Equities — Bursa Purchase',  25000.00,  'investment', 'Equities',          '2025-07-22', 'BURS-20250722', 'KLCI index ETF'),
    (3, 'Monthly Savings Transfer',   10000.00,  'savings',   'Savings',            '2025-07-01', 'SAV-2025-07',   NULL),
    (NULL, 'Client Invoice #1042',    75000.00,  'income',    'Revenue',            '2025-07-05', 'INV-1042',      'PT Maju Jaya — retainer'),
    (NULL, 'Client Invoice #1043',    30000.00,  'income',    'Revenue',            '2025-07-18', 'INV-1043',      'Ad-hoc consulting');
