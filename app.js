// app.js - entry point of the application.
// It creates the Express app, configures EJS, plugs in the routes and starts the server.

// Load settings from a ".env" file if one exists (built into Node 20.12+; ignored otherwise).
try {
  process.loadEnvFile();
} catch (err) {
  // no .env file (or older Node version) - defaults from config/db.js are used
}

const express = require('express');
const path = require('path');
const pool = require('./config/db');
const libraryRoutes = require('./routes/libraryRoutes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Use EJS for the HTML pages stored in the "views" folder
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Read form data (POST bodies) and serve CSS/JS from "public"
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Values available in every EJS page
app.use((req, res, next) => {
  // Success / error message passed in the URL after a redirect (?type=success&msg=...)
  res.locals.flash = req.query.msg
    ? {
        type: req.query.type === 'success' ? 'success' : 'danger',
        text: String(req.query.msg).slice(0, 300),
      }
    : null;

  // Format a number as rupees, e.g. 30 -> "₹30.00"
  res.locals.money = (n) => '₹' + Number(n || 0).toFixed(2);

  // Bootstrap colour for a borrowing status badge
  res.locals.statusClass = (status) =>
    ({ Returned: 'success', Overdue: 'danger', Borrowed: 'primary', Paid: 'success', Unpaid: 'warning' }[status] ||
    'secondary');

  next();
});

app.use('/', libraryRoutes);

// 404 - no route matched
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    heading: 'Page not found',
    message: 'The page you are looking for does not exist.',
  });
});

// Error handler - runs when a route throws (for example a database error)
app.use((err, req, res, next) => {
  console.error(err);

  let message = 'Something went wrong while processing your request.';
  if (err.code === 'ECONNREFUSED') {
    message = 'Cannot reach MySQL. Make sure the MySQL server is running.';
  } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    message = 'MySQL rejected the username/password. Check config/db.js or your .env file.';
  } else if (err.code === 'ER_BAD_DB_ERROR') {
    message = 'Database "digital_library" not found. Run database.sql first.';
  } else if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_SP_DOES_NOT_EXIST') {
    message = 'Database objects are missing. Run database.sql to create the tables and function.';
  }

  res.status(500).render('error', { title: 'Error', heading: 'Error', message });
});

// Start the server, then test the database connection and report the result in the terminal.
app.listen(PORT, () => {
  console.log(`Digital Library running at http://localhost:${PORT}`);

  pool
    .query('SELECT 1')
    .then(() => console.log('MySQL connection: OK'))
    .catch((err) => {
      console.error('MySQL connection FAILED: ' + err.message);
      console.error('Check that MySQL is running, database.sql was imported, and your username/password are set.');
    });
});
