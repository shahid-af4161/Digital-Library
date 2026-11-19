// config/db.js
// ---------------------------------------------------------------------
// Creates ONE shared MySQL connection pool. Every route imports this file
// and calls pool.query(...) to talk to the database.
//
//   +----------------------------------------------------------------+
//   |  ENTER YOUR MYSQL USERNAME AND PASSWORD BELOW (user / password) |
//   |  or put them in a ".env" file (see .env.example).               |
//   +----------------------------------------------------------------+
// ---------------------------------------------------------------------
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',        // <-- your MySQL username
  password: process.env.DB_PASSWORD || 'database5816',    // <-- your MySQL password
  database: process.env.DB_NAME || 'digital_library',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE columns come back as plain 'YYYY-MM-DD' text
});

module.exports = pool;
