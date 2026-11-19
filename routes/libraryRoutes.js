// routes/libraryRoutes.js
// All pages and actions of the application live here:
//   Dashboard, Books, Authors, Members, Borrow/Return and Fines.
// GET routes show pages; POST routes change data and then redirect.

const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// Library rules (can be changed in the .env file)
const LOAN_DAYS = Number(process.env.LOAN_DAYS) || 14;
const FINE_PER_DAY = Number(process.env.FINE_PER_DAY) || 5;

// SQL snippet that turns a Borrow_Log row into a readable status
const STATUS_SQL = `CASE
    WHEN bl.return_date IS NOT NULL THEN 'Returned'
    WHEN bl.due_date < CURDATE()    THEN 'Overdue'
    ELSE 'Borrowed'
  END`;

// ---------- small helper functions ----------

// An error caused by the user's input (not a bug) - its message is shown on the page
class AppError extends Error {}

// Sends errors from async routes to the error handler in app.js
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Redirect to a page and show a message there
function redirectWith(res, url, type, text) {
  const joiner = url.includes('?') ? '&' : '?';
  res.redirect(`${url}${joiner}type=${type}&msg=${encodeURIComponent(text)}`);
}

// Trim form values safely
const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());

async function safeRollback(conn) {
  try {
    await conn.rollback();
  } catch (err) {
    // ignore - the connection may already be closed
  }
}

// =====================================================================
// DASHBOARD
// =====================================================================
router.get(
  '/',
  wrap(async (req, res) => {
    const [[bookStats]] = await pool.query(
      'SELECT COUNT(*) AS total_titles, COALESCE(SUM(available_copies), 0) AS available_copies FROM Book'
    );
    const [[memberStats]] = await pool.query('SELECT COUNT(*) AS total FROM Member');

    // Books that are out right now, and how many of them are past the due date
    const [[borrowStats]] = await pool.query(
      `SELECT COUNT(*) AS borrowed,
              COALESCE(SUM(due_date < CURDATE()), 0) AS overdue
         FROM Borrow_Log
        WHERE return_date IS NULL`
    );

    // Fines already recorded and still unpaid
    const [[fineStats]] = await pool.query(
      `SELECT COALESCE(SUM(fine_amount), 0) AS unpaid
         FROM Fine_Record
        WHERE status = 'Unpaid'`
    );

    // Fines that are still growing on overdue books that have not been returned yet
    const [[accruing]] = await pool.query(
      `SELECT COALESCE(SUM(DATEDIFF(CURDATE(), due_date)), 0) AS overdue_days
         FROM Borrow_Log
        WHERE return_date IS NULL AND due_date < CURDATE()`
    );

    // Recent activity: JOIN Borrow_Log with Member and Book
    const [recent] = await pool.query(
      `SELECT m.name AS member_name, b.title, bl.issue_date, bl.due_date, bl.return_date,
              ${STATUS_SQL} AS status
         FROM Borrow_Log bl
         JOIN Member m ON m.member_id = bl.member_id
         JOIN Book b   ON b.book_id   = bl.book_id
        ORDER BY GREATEST(bl.issue_date, COALESCE(bl.return_date, bl.issue_date)) DESC, bl.issue_date DESC
        LIMIT 8`
    );

    res.render('dashboard', {
      stats: {
        totalBooks: Number(bookStats.total_titles),
        availableCopies: Number(bookStats.available_copies),
        totalMembers: Number(memberStats.total),
        borrowed: Number(borrowStats.borrowed),
        overdue: Number(borrowStats.overdue),
        outstandingFines: Number(fineStats.unpaid),
        accruingFines: Number(accruing.overdue_days) * FINE_PER_DAY,
      },
      recent,
    });
  })
);

// =====================================================================
// BOOKS
// =====================================================================

// List books (with optional search by title, author or ISBN)
router.get(
  '/books',
  wrap(async (req, res) => {
    const q = clean(req.query.q);
    let sql = `SELECT b.book_id, b.title, b.isbn, a.name AS author_name, b.category,
                      b.publication_year, b.available_copies
                 FROM Book b
                 JOIN Author a ON a.author_id = b.author_id`;
    const params = [];

    if (q) {
      sql += ' WHERE b.title LIKE ? OR a.name LIKE ? OR b.isbn LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY b.title';

    const [books] = await pool.query(sql, params);
    res.render('books', { books, q });
  })
);

// Show the "Add Book" form
router.get(
  '/books/add',
  wrap(async (req, res) => {
    const [authors] = await pool.query('SELECT author_id, name FROM Author ORDER BY name');
    res.render('addBook', { authors, old: {}, error: null });
  })
);

// Save a new book
router.post(
  '/books/add',
  wrap(async (req, res) => {
    const old = {
      title: clean(req.body.title),
      isbn: clean(req.body.isbn),
      author_id: clean(req.body.author_id),
      category: clean(req.body.category),
      publication_year: clean(req.body.publication_year),
      available_copies: clean(req.body.available_copies),
    };

    const [authors] = await pool.query('SELECT author_id, name FROM Author ORDER BY name');
    const showError = (message) => res.status(400).render('addBook', { authors, old, error: message });

    // --- basic validation ---
    const isbn = old.isbn.replace(/[-\s]/g, '').toUpperCase();
    const authorId = Number(old.author_id);
    const year = Number(old.publication_year);
    const copies = Number(old.available_copies);
    const thisYear = new Date().getFullYear();

    if (!old.title) return showError('Title is required.');
    if (old.title.length > 200) return showError('Title must be 200 characters or less.');
    if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) {
      return showError('ISBN must have 10 or 13 characters (digits only, hyphens are allowed).');
    }
    if (!Number.isInteger(authorId) || authorId < 1) return showError('Please choose an author.');
    if (!old.category) return showError('Category is required.');
    if (old.category.length > 50) return showError('Category must be 50 characters or less.');
    if (!Number.isInteger(year) || year < 1000 || year > thisYear) {
      return showError(`Publication year must be a number between 1000 and ${thisYear}.`);
    }
    if (!Number.isInteger(copies) || copies < 1 || copies > 1000) {
      return showError('Available copies must be a whole number between 1 and 1000.');
    }

    try {
      await pool.query(
        `INSERT INTO Book (title, isbn, author_id, category, publication_year, available_copies)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [old.title, isbn, authorId, old.category, year, copies]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return showError('A book with this ISBN already exists.');
      if (err.code === 'ER_NO_REFERENCED_ROW_2') return showError('The selected author does not exist.');
      throw err;
    }

    redirectWith(res, '/books', 'success', `Book "${old.title}" was added.`);
  })
);

// Delete a book (only if it has never been borrowed)
router.post(
  '/books/delete/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return redirectWith(res, '/books', 'danger', 'Invalid book.');

    const [[history]] = await pool.query('SELECT COUNT(*) AS c FROM Borrow_Log WHERE book_id = ?', [id]);
    if (history.c > 0) {
      return redirectWith(res, '/books', 'danger', 'Cannot delete this book because it has borrowing records.');
    }

    const [result] = await pool.query('DELETE FROM Book WHERE book_id = ?', [id]);
    if (result.affectedRows === 0) return redirectWith(res, '/books', 'danger', 'Book not found.');

    redirectWith(res, '/books', 'success', 'Book deleted.');
  })
);

// =====================================================================
// AUTHORS
// =====================================================================

// List authors (the "Add Author" form is on the same page)
router.get(
  '/authors',
  wrap(async (req, res) => {
    const [authors] = await pool.query(
      `SELECT a.author_id, a.name, a.biography, COUNT(b.book_id) AS book_count
         FROM Author a
         LEFT JOIN Book b ON b.author_id = a.author_id
        GROUP BY a.author_id, a.name, a.biography
        ORDER BY a.name`
    );
    res.render('authors', { authors, old: {}, error: null });
  })
);

// Save a new author
router.post(
  '/authors/add',
  wrap(async (req, res) => {
    const name = clean(req.body.name);
    const biography = clean(req.body.biography);

    const showError = async (message) => {
      const [authors] = await pool.query(
        `SELECT a.author_id, a.name, a.biography, COUNT(b.book_id) AS book_count
           FROM Author a
           LEFT JOIN Book b ON b.author_id = a.author_id
          GROUP BY a.author_id, a.name, a.biography
          ORDER BY a.name`
      );
      res.status(400).render('authors', { authors, old: { name, biography }, error: message });
    };

    if (name.length < 2) return showError('Author name must have at least 2 characters.');
    if (name.length > 100) return showError('Author name must be 100 characters or less.');
    if (biography.length > 2000) return showError('Biography must be 2000 characters or less.');

    try {
      await pool.query('INSERT INTO Author (name, biography) VALUES (?, ?)', [name, biography || null]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return showError('An author with this name already exists.');
      throw err;
    }

    redirectWith(res, '/authors', 'success', `Author "${name}" was added.`);
  })
);

// =====================================================================
// MEMBERS
// =====================================================================

// List members (with optional search by name, email or phone)
router.get(
  '/members',
  wrap(async (req, res) => {
    const q = clean(req.query.q);
    let sql = `SELECT m.member_id, m.name, m.email, m.phone, m.registration_date,
                      TIMESTAMPDIFF(MONTH, m.registration_date, CURDATE()) AS months_registered,
                      (SELECT COUNT(*) FROM Borrow_Log bl
                        WHERE bl.member_id = m.member_id AND bl.return_date IS NULL) AS active_loans
                 FROM Member m`;
    const params = [];

    if (q) {
      sql += ' WHERE m.name LIKE ? OR m.email LIKE ? OR m.phone LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY m.name';

    const [members] = await pool.query(sql, params);
    res.render('members', { members, q });
  })
);

// Show the "Register Member" form
router.get('/members/add', (req, res) => {
  res.render('addMember', { old: {}, error: null });
});

// Save a new member
router.post(
  '/members/add',
  wrap(async (req, res) => {
    const old = {
      name: clean(req.body.name),
      email: clean(req.body.email).toLowerCase(),
      phone: clean(req.body.phone),
    };
    const showError = (message) => res.status(400).render('addMember', { old, error: message });

    if (old.name.length < 2) return showError('Name must have at least 2 characters.');
    if (old.name.length > 100) return showError('Name must be 100 characters or less.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(old.email) || old.email.length > 120) {
      return showError('Please enter a valid email address.');
    }
    if (!/^\d{10}$/.test(old.phone)) return showError('Phone number must be exactly 10 digits.');

    try {
      // registration_date is set by MySQL's CURDATE() function
      await pool.query('INSERT INTO Member (name, email, phone, registration_date) VALUES (?, ?, ?, CURDATE())', [
        old.name,
        old.email,
        old.phone,
      ]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return showError('A member with this email already exists.');
      throw err;
    }

    redirectWith(res, '/members', 'success', `Member "${old.name}" was registered.`);
  })
);

// Delete a member (only if no active borrowing and no unpaid fines)
router.post(
  '/members/delete/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return redirectWith(res, '/members', 'danger', 'Invalid member.');

    const [[active]] = await pool.query(
      'SELECT COUNT(*) AS c FROM Borrow_Log WHERE member_id = ? AND return_date IS NULL',
      [id]
    );
    if (active.c > 0) {
      return redirectWith(res, '/members', 'danger', 'Cannot delete: this member still has books borrowed.');
    }

    const [[unpaid]] = await pool.query(
      "SELECT COUNT(*) AS c FROM Fine_Record WHERE member_id = ? AND status = 'Unpaid'",
      [id]
    );
    if (unpaid.c > 0) {
      return redirectWith(res, '/members', 'danger', 'Cannot delete: this member has unpaid fines.');
    }

    // Returned history and paid fines are removed automatically (ON DELETE CASCADE)
    const [result] = await pool.query('DELETE FROM Member WHERE member_id = ?', [id]);
    if (result.affectedRows === 0) return redirectWith(res, '/members', 'danger', 'Member not found.');

    redirectWith(res, '/members', 'success', 'Member deleted.');
  })
);

// =====================================================================
// BORROWING AND RETURNING
// =====================================================================

// Issue form + currently borrowed books + all borrowing records
router.get(
  '/borrow',
  wrap(async (req, res) => {
    const [members] = await pool.query('SELECT member_id, name FROM Member ORDER BY name');
    const [books] = await pool.query('SELECT book_id, title, available_copies FROM Book ORDER BY title');

    // Books that have not been returned yet
    const [current] = await pool.query(
      `SELECT bl.member_id, bl.book_id, bl.issue_date, bl.due_date,
              m.name AS member_name, b.title,
              DATEDIFF(CURDATE(), bl.issue_date) AS days_held,
              DATEDIFF(bl.due_date, CURDATE()) AS days_left,
              GREATEST(DATEDIFF(CURDATE(), bl.due_date), 0) AS days_overdue,
              ${STATUS_SQL} AS status
         FROM Borrow_Log bl
         JOIN Member m ON m.member_id = bl.member_id
         JOIN Book b   ON b.book_id   = bl.book_id
        WHERE bl.return_date IS NULL
        ORDER BY bl.due_date, m.name`
    );

    // Every borrowing record (returned and not returned)
    const [all] = await pool.query(
      `SELECT m.name AS member_name, b.title, bl.issue_date, bl.due_date, bl.return_date,
              TIMESTAMPDIFF(DAY, bl.issue_date, COALESCE(bl.return_date, CURDATE())) AS days_kept,
              ${STATUS_SQL} AS status
         FROM Borrow_Log bl
         JOIN Member m ON m.member_id = bl.member_id
         JOIN Book b   ON b.book_id   = bl.book_id
        ORDER BY bl.issue_date DESC, m.name`
    );

    res.render('borrow', { members, books, current, all, loanDays: LOAN_DAYS, finePerDay: FINE_PER_DAY });
  })
);

// Issue a book to a member (runs as one database transaction)
router.post(
  '/borrow/issue',
  wrap(async (req, res) => {
    const memberId = Number(req.body.member_id);
    const bookId = Number(req.body.book_id);

    if (!Number.isInteger(memberId) || memberId < 1 || !Number.isInteger(bookId) || bookId < 1) {
      return redirectWith(res, '/borrow', 'danger', 'Please select both a member and a book.');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Lock the book row so two people cannot take the last copy at the same time
      const [bookRows] = await conn.query(
        'SELECT title, available_copies FROM Book WHERE book_id = ? FOR UPDATE',
        [bookId]
      );
      if (bookRows.length === 0) throw new AppError('Book not found.');
      if (bookRows[0].available_copies < 1) {
        throw new AppError(`No copies of "${bookRows[0].title}" are available right now.`);
      }

      const [memberRows] = await conn.query('SELECT name FROM Member WHERE member_id = ?', [memberId]);
      if (memberRows.length === 0) throw new AppError('Member not found.');

      // The same member cannot hold the same book twice at the same time
      const [activeRows] = await conn.query(
        'SELECT 1 FROM Borrow_Log WHERE member_id = ? AND book_id = ? AND return_date IS NULL',
        [memberId, bookId]
      );
      if (activeRows.length > 0) {
        throw new AppError(`${memberRows[0].name} has already borrowed "${bookRows[0].title}" and not returned it.`);
      }

      // issue date = today, due date = today + 14 days (calculated by MySQL date functions)
      await conn.query(
        `INSERT INTO Borrow_Log (member_id, book_id, issue_date, due_date)
         VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY))`,
        [memberId, bookId, LOAN_DAYS]
      );
      await conn.query('UPDATE Book SET available_copies = available_copies - 1 WHERE book_id = ?', [bookId]);

      const [[issued]] = await conn.query(
        'SELECT due_date FROM Borrow_Log WHERE member_id = ? AND book_id = ? AND issue_date = CURDATE()',
        [memberId, bookId]
      );

      await conn.commit();
      redirectWith(
        res,
        '/borrow',
        'success',
        `"${bookRows[0].title}" issued to ${memberRows[0].name}. Due date: ${issued.due_date}.`
      );
    } catch (err) {
      await safeRollback(conn);
      if (err instanceof AppError) return redirectWith(res, '/borrow', 'danger', err.message);
      if (err.code === 'ER_DUP_ENTRY') {
        return redirectWith(res, '/borrow', 'danger', 'This book was already issued to this member today.');
      }
      throw err;
    } finally {
      conn.release();
    }
  })
);

// Return a book (runs as one database transaction)
router.post(
  '/borrow/return',
  wrap(async (req, res) => {
    const memberId = Number(req.body.member_id);
    const bookId = Number(req.body.book_id);
    const issueDate = clean(req.body.issue_date);

    if (!Number.isInteger(memberId) || !Number.isInteger(bookId) || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      return redirectWith(res, '/borrow', 'danger', 'Invalid return request.');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query(
        `SELECT return_date, DATEDIFF(CURDATE(), due_date) AS days_late
           FROM Borrow_Log
          WHERE member_id = ? AND book_id = ? AND issue_date = ?
            FOR UPDATE`,
        [memberId, bookId, issueDate]
      );
      if (rows.length === 0) throw new AppError('Borrowing record not found.');
      if (rows[0].return_date !== null) throw new AppError('This book has already been returned.');

      await conn.query(
        'UPDATE Borrow_Log SET return_date = CURDATE() WHERE member_id = ? AND book_id = ? AND issue_date = ?',
        [memberId, bookId, issueDate]
      );
      await conn.query('UPDATE Book SET available_copies = available_copies + 1 WHERE book_id = ?', [bookId]);

      // Late return -> create a fine record (days late x fine per day)
      const daysLate = Number(rows[0].days_late);
      let fine = 0;
      if (daysLate > 0) {
        fine = daysLate * FINE_PER_DAY;
        await conn.query(
          `INSERT INTO Fine_Record (member_id, book_id, issue_date, overdue_days, fine_amount)
           VALUES (?, ?, ?, ?, ?)`,
          [memberId, bookId, issueDate, daysLate, fine]
        );
      }

      await conn.commit();

      if (fine > 0) {
        redirectWith(res, '/borrow', 'success', `Book returned ${daysLate} day(s) late. Fine of ₹${fine.toFixed(2)} recorded.`);
      } else {
        redirectWith(res, '/borrow', 'success', 'Book returned on time. No fine.');
      }
    } catch (err) {
      await safeRollback(conn);
      if (err instanceof AppError) return redirectWith(res, '/borrow', 'danger', err.message);
      throw err;
    } finally {
      conn.release();
    }
  })
);

// =====================================================================
// FINES
// =====================================================================

router.get(
  '/fines',
  wrap(async (req, res) => {
    // Optional filter: /fines?status=Paid or /fines?status=Unpaid
    const status = ['Paid', 'Unpaid'].includes(req.query.status) ? req.query.status : '';

    // Totals for the summary cards
    const [[totals]] = await pool.query(
      `SELECT COALESCE(SUM(fine_amount), 0) AS total,
              COALESCE(SUM(CASE WHEN status = 'Unpaid' THEN fine_amount END), 0) AS unpaid,
              COALESCE(SUM(CASE WHEN status = 'Paid'   THEN fine_amount END), 0) AS paid
         FROM Fine_Record`
    );

    // Member-wise fines. get_total_fines() is the stored function from database.sql
    const [memberFines] = await pool.query(
      `SELECT m.member_id, m.name, m.email,
              get_total_fines(m.member_id) AS total_fines,
              COALESCE(SUM(CASE WHEN f.status = 'Unpaid' THEN f.fine_amount END), 0) AS unpaid,
              COALESCE(SUM(CASE WHEN f.status = 'Paid'   THEN f.fine_amount END), 0) AS paid
         FROM Member m
         JOIN Fine_Record f ON f.member_id = m.member_id
        GROUP BY m.member_id, m.name, m.email
        ORDER BY unpaid DESC, m.name`
    );

    // Individual fine records (JOIN of four tables)
    let fineSql = `SELECT f.fine_id, m.name AS member_name, b.title, f.issue_date, bl.due_date, bl.return_date,
                          f.overdue_days, f.fine_amount, f.status, f.paid_date
                     FROM Fine_Record f
                     JOIN Borrow_Log bl ON bl.member_id = f.member_id
                                       AND bl.book_id = f.book_id
                                       AND bl.issue_date = f.issue_date
                     JOIN Member m ON m.member_id = f.member_id
                     JOIN Book b   ON b.book_id = f.book_id`;
    const params = [];
    if (status) {
      fineSql += ' WHERE f.status = ?';
      params.push(status);
    }
    fineSql += " ORDER BY FIELD(f.status, 'Unpaid', 'Paid'), f.fine_id DESC";
    const [fines] = await pool.query(fineSql, params);

    // Overdue books that are still with the member (fine is still growing)
    const [overdue] = await pool.query(
      `SELECT m.name AS member_name, b.title, bl.issue_date, bl.due_date,
              DATEDIFF(CURDATE(), bl.due_date) AS days_overdue
         FROM Borrow_Log bl
         JOIN Member m ON m.member_id = bl.member_id
         JOIN Book b   ON b.book_id   = bl.book_id
        WHERE bl.return_date IS NULL AND bl.due_date < CURDATE()
        ORDER BY days_overdue DESC`
    );

    res.render('fines', { totals, memberFines, fines, overdue, status, finePerDay: FINE_PER_DAY });
  })
);

// Mark a fine as paid
router.post(
  '/fines/pay/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return redirectWith(res, '/fines', 'danger', 'Invalid fine.');

    const [result] = await pool.query(
      "UPDATE Fine_Record SET status = 'Paid', paid_date = CURDATE() WHERE fine_id = ? AND status = 'Unpaid'",
      [id]
    );
    if (result.affectedRows === 0) {
      return redirectWith(res, '/fines', 'danger', 'Fine not found or already paid.');
    }

    redirectWith(res, '/fines', 'success', 'Fine marked as paid.');
  })
);

module.exports = router;
