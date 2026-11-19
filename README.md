# Digital Library & E-Book Rental Ledger

A simple Digital Library Management System built for a college DBMS project.

**Stack:** Node.js, Express.js, EJS, MySQL (`mysql2`), HTML, CSS, JavaScript, Bootstrap 5.

## 1. Requirements

- Node.js 18 or newer (`node -v`)
- MySQL 8.0.16 or newer, running locally (CHECK constraints are only enforced from this version)
- An internet connection in the browser (Bootstrap is loaded from a CDN)

## 2. Installation

```bash
cd digital-library
npm install
```

This installs `express`, `ejs` and `mysql2`.

## 3. Database setup

Create the database, tables, stored function and sample data with one command:

```bash
mysql -u root -p < database.sql
```

(Alternatively open `database.sql` in MySQL Workbench and run the whole script.)

The script is safe to run again: it recreates the tables and the sample data.

## 4. Enter your MySQL username and password

Choose **one** of these:

**Option A - edit `config/db.js`** and change the two marked lines:

```js
user: process.env.DB_USER || 'root',        // <-- your MySQL username
password: process.env.DB_PASSWORD || '',    // <-- your MySQL password
```

**Option B - use a `.env` file** (Node 20.12+ loads it automatically):

```bash
cp .env.example .env      # on Windows: copy .env.example .env
```

then edit `.env` and set `DB_USER` and `DB_PASSWORD`.

## 5. Run the application

```bash
npm start
```

The terminal should print:

```
Digital Library running at http://localhost:3000
MySQL connection: OK
```

Open **http://localhost:3000** in your browser. If it prints `MySQL connection FAILED`, check that MySQL is running, `database.sql` was imported, and your username/password are correct.

## 6. Features

| Module | What you can do |
|---|---|
| Dashboard | Total books, members, currently borrowed, overdue books, outstanding fines, recent borrowing activity |
| Books | Add, list, search (title / author / ISBN), delete (not allowed if the book has borrowing records) |
| Authors | Add and list authors with biography; books are linked through a foreign key |
| Members | Register, list, search, delete (blocked if the member has books out or unpaid fines) |
| Borrow / Return | Issue a book (14-day due date set automatically), return a book, see current and all records; available copies update automatically |
| Fines | Fine of Rs. 5 per overdue day created on late return, member-wise totals, paid / unpaid filter, "Mark Paid" button |

Business rules enforced by the server:

- A book cannot be issued when no copies are available.
- A member cannot borrow the same book again while still holding it.
- Issue and return each run inside a **database transaction**, so the borrow record and the copy count never get out of sync.
- Paid fines are not counted as outstanding.

Settings (optional, in `.env`): `LOAN_DAYS` (default 14), `FINE_PER_DAY` (default 5), `PORT` (default 3000).

## 7. Project structure

```
digital-library/
├── config/db.js              MySQL connection pool (enter credentials here)
├── routes/libraryRoutes.js   All routes: dashboard, books, authors, members, borrow, fines
├── views/
│   ├── partials/             header.ejs, sidebar.ejs, footer.ejs (shared layout)
│   ├── dashboard.ejs  books.ejs  addBook.ejs  authors.ejs
│   ├── members.ejs    addMember.ejs  borrow.ejs  fines.ejs
│   └── error.ejs             Shown for 404 and database errors
├── public/css/style.css      Custom styles
├── public/js/script.js       Delete/return confirmation prompts
├── database.sql              Tables, constraints, stored function, sample data
├── app.js                    Express setup and server start
├── package.json
└── README.md
```

## 8. DBMS concepts used (useful for your viva)

| Concept | Where |
|---|---|
| Primary keys | Every table (`author_id`, `book_id`, `member_id`, `fine_id`) |
| Composite primary key | `Borrow_Log (member_id, book_id, issue_date)` - prevents duplicate borrowing transactions |
| Foreign keys | `Book -> Author`, `Borrow_Log -> Member / Book`, `Fine_Record -> Borrow_Log` (composite FK) |
| NOT NULL / UNIQUE | `Book.isbn`, `Member.email`, `Author.name`, one fine per borrowing (`uq_fine_per_borrow`) |
| CHECK | `available_copies >= 0`, valid year, 10-digit phone, `due_date >= issue_date`, `fine_amount > 0`, paid fines must have a paid date |
| Referential actions | Deleting a member cascades to their history; a borrowed book cannot be deleted (`RESTRICT`) |
| JOINs | Book + Author, Borrow_Log + Member + Book, Fine_Record + Borrow_Log + Member + Book |
| Date functions | `CURDATE()`, `DATE_ADD` (due date), `DATEDIFF` (days overdue, days held), `TIMESTAMPDIFF(MONTH/DAY, ...)` |
| Stored function | `get_total_fines(member_id)` - used on the Fines page for member-wise totals |
| Transactions | Issue and return (`beginTransaction`, `FOR UPDATE`, `commit`, `rollback`) |

Oracle to MySQL equivalents used: `SYSDATE` -> `NOW()` / `CURDATE()`, `MONTHS_BETWEEN` -> `TIMESTAMPDIFF(MONTH, ...)`.

Try the function directly in MySQL:

```sql
USE digital_library;
SELECT get_total_fines(5);   -- 50.00 with the sample data
```

## 9. Sample data to demonstrate

- 8 authors, 12 books, 8 members, 15 borrowing records.
- 8 books are currently borrowed, 3 of them overdue.
- "The Clean Coder" has 0 copies left, so issuing it shows the "no copies available" message.
- Fines: Rs. 110 unpaid and Rs. 35 paid across 5 members.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `Access denied for user` | Wrong username/password in `config/db.js` or `.env` |
| `Unknown database 'digital_library'` | Run `database.sql` first |
| `ECONNREFUSED` | MySQL server is not running |
| Page has no styling | The browser needs internet access for the Bootstrap CDN |
| `ER_SP_DOES_NOT_EXIST` | The stored function is missing; re-run the whole `database.sql` |
