// db.js — Database connection module
// Fetches RDS credentials securely from AWS Secrets Manager,
// then creates a persistent MySQL2 connection pool.

"use strict";

const mysql = require("mysql2/promise");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
require("dotenv").config();

// ─── AWS Secrets Manager client ──────────────────────────────────────────────
// Region is read from the environment variable AWS_REGION (set in .env or
// the EC2 instance profile).  No access keys are stored in code — the EC2
// instance role grants the necessary secretsmanager:GetSecretValue permission.
const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

/**
 * Retrieves the RDS credentials JSON from Secrets Manager.
 * The secret is expected to be stored as a JSON string with the shape:
 *   { "username": "...", "password": "...", "host": "...", "port": 3306, "dbname": "..." }
 *
 * @returns {Promise<Object>} Parsed credentials object
 */
async function getRdsCredentials() {
  const secretName = process.env.DB_SECRET_NAME; // e.g. "prod/financetracker/rds"

  if (!secretName) {
    throw new Error(
      "DB_SECRET_NAME is not set. Add it to your .env or EC2 environment."
    );
  }

  console.log(`[Secrets Manager] Fetching secret: ${secretName}`);

  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await secretsClient.send(command);

  // The secret value can be a string or a binary.
  // RDS auto-rotation always stores credentials as a JSON string.
  const secretPayload =
    response.SecretString ||
    Buffer.from(response.SecretBinary, "base64").toString("utf8");

  return JSON.parse(secretPayload);
}

// ─── Module-level pool reference ─────────────────────────────────────────────
// The pool is initialised once and then reused for every request.
let pool = null;

/**
 * Returns a MySQL2 connection pool, creating it on first call.
 * Subsequent calls return the already-initialised pool.
 *
 * @returns {Promise<mysql.Pool>}
 */
async function getPool() {
  if (pool) return pool;

  let credentials;

  try {
    // Attempt to load credentials from Secrets Manager (production path)
    credentials = await getRdsCredentials();
  } catch (err) {
    // Fallback: use plain environment variables for local development
    console.warn(
      `[DB] Secrets Manager unavailable (${err.message}). Falling back to .env credentials.`
    );
    credentials = {
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "3306", 10),
      dbname: process.env.DB_NAME,
    };
  }

  const { username, password, host, port, dbname } = credentials;

  if (!username || !password || !host || !dbname) {
    throw new Error(
      "Incomplete database credentials. Check Secrets Manager or .env file."
    );
  }

  console.log(`[DB] Creating connection pool → ${host}:${port}/${dbname}`);

  pool = mysql.createPool({
    host,
    port,
    user: username,
    password,
    database: dbname,
    waitForConnections: true,
    connectionLimit: 10,      // Max concurrent connections in the pool
    queueLimit: 0,            // Unlimited request queue
    enableKeepAlive: true,    // Prevent idle connection timeouts on RDS
    keepAliveInitialDelay: 0,
    timezone: "+00:00",       // Store / return all dates in UTC
  });

  // Verify connectivity at startup so errors surface immediately
  const conn = await pool.getConnection();
  console.log("[DB] Connection pool ready — test query OK");
  conn.release();

  return pool;
}

/**
 * Executes a parameterised SQL query via the shared pool.
 *
 * @param {string} sql   Parameterised SQL string  (e.g. "SELECT * FROM t WHERE id = ?")
 * @param {Array}  params Ordered parameter values  (e.g. [42])
 * @returns {Promise<Array>} Array of result rows
 */
async function query(sql, params = []) {
  const db = await getPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

module.exports = { getPool, query };
