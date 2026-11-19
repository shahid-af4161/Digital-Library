-- =====================================================================
--  Digital Library & E-Book Rental Ledger  -  database.sql
--  Run once:   mysql -u root -p < database.sql
--  Requires:   MySQL 8.0.16 or newer (CHECK constraints are enforced
--              from this version onwards).
--  Safe to re-run: it drops and recreates the tables (and the sample data).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS digital_library
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE digital_library;

-- Drop in reverse order of dependency (children first)
DROP FUNCTION IF EXISTS get_total_fines;
DROP TABLE IF EXISTS Fine_Record;
DROP TABLE IF EXISTS Borrow_Log;
DROP TABLE IF EXISTS Book;
DROP TABLE IF EXISTS Member;
DROP TABLE IF EXISTS Author;

-- ---------------------------------------------------------------------
-- 1. AUTHOR
-- ---------------------------------------------------------------------
CREATE TABLE Author (
  author_id  INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  biography  TEXT NULL
);

-- ---------------------------------------------------------------------
-- 2. BOOK   (many books -> one author)
-- ---------------------------------------------------------------------
CREATE TABLE Book (
  book_id           INT AUTO_INCREMENT PRIMARY KEY,
  title             VARCHAR(200) NOT NULL,
  isbn              VARCHAR(13)  NOT NULL UNIQUE,
  author_id         INT          NOT NULL,
  category          VARCHAR(50)  NOT NULL,
  publication_year  SMALLINT     NOT NULL,
  available_copies  INT          NOT NULL DEFAULT 1,
  CONSTRAINT chk_book_copies CHECK (available_copies >= 0),
  CONSTRAINT chk_book_year   CHECK (publication_year BETWEEN 1000 AND 2100),
  CONSTRAINT fk_book_author  FOREIGN KEY (author_id)
    REFERENCES Author (author_id)
    ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 3. MEMBER
-- ---------------------------------------------------------------------
CREATE TABLE Member (
  member_id          INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(100) NOT NULL,
  email              VARCHAR(120) NOT NULL UNIQUE,
  phone              CHAR(10)     NOT NULL,
  registration_date  DATE         NOT NULL,
  CONSTRAINT chk_member_phone CHECK (phone REGEXP '^[0-9]{10}$'),
  CONSTRAINT chk_member_name  CHECK (CHAR_LENGTH(TRIM(name)) >= 2)
);

-- ---------------------------------------------------------------------
-- 4. BORROW_LOG   (which member borrowed which book, and when)
--    Composite PRIMARY KEY (member_id, book_id, issue_date) means the same
--    member cannot be issued the same book twice on the same day.
--    return_date = NULL  ->  the book is still borrowed.
-- ---------------------------------------------------------------------
CREATE TABLE Borrow_Log (
  member_id    INT  NOT NULL,
  book_id      INT  NOT NULL,
  issue_date   DATE NOT NULL,
  due_date     DATE NOT NULL,
  return_date  DATE NULL,
  PRIMARY KEY (member_id, book_id, issue_date),
  CONSTRAINT chk_borrow_due    CHECK (due_date >= issue_date),
  CONSTRAINT chk_borrow_return CHECK (return_date IS NULL OR return_date >= issue_date),
  -- deleting a member also removes their (returned) history
  CONSTRAINT fk_borrow_member FOREIGN KEY (member_id)
    REFERENCES Member (member_id) ON DELETE CASCADE,
  -- a book that has borrowing history cannot be deleted
  CONSTRAINT fk_borrow_book FOREIGN KEY (book_id)
    REFERENCES Book (book_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 5. FINE_RECORD   (one fine per late-returned borrowing)
--    The composite FOREIGN KEY points to the composite key of Borrow_Log.
-- ---------------------------------------------------------------------
CREATE TABLE Fine_Record (
  fine_id       INT AUTO_INCREMENT PRIMARY KEY,
  member_id     INT           NOT NULL,
  book_id       INT           NOT NULL,
  issue_date    DATE          NOT NULL,
  overdue_days  INT           NOT NULL,
  fine_amount   DECIMAL(8,2)  NOT NULL,
  status        ENUM('Unpaid','Paid') NOT NULL DEFAULT 'Unpaid',
  paid_date     DATE NULL,
  CONSTRAINT uq_fine_per_borrow UNIQUE (member_id, book_id, issue_date),
  CONSTRAINT chk_fine_days   CHECK (overdue_days > 0),
  CONSTRAINT chk_fine_amount CHECK (fine_amount > 0),
  CONSTRAINT chk_fine_paid   CHECK (
       (status = 'Paid'   AND paid_date IS NOT NULL)
    OR (status = 'Unpaid' AND paid_date IS NULL)),
  CONSTRAINT fk_fine_borrow FOREIGN KEY (member_id, book_id, issue_date)
    REFERENCES Borrow_Log (member_id, book_id, issue_date)
    ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- STORED FUNCTION: get_total_fines(member_id)
-- Returns the total accumulated fines (paid + unpaid) of one member.
-- Usage:  SELECT get_total_fines(2);
-- (MySQL equivalents used in this project:  SYSDATE -> NOW()/CURDATE(),
--  MONTHS_BETWEEN -> TIMESTAMPDIFF(MONTH, ...))
-- ---------------------------------------------------------------------
DELIMITER $$

CREATE FUNCTION get_total_fines(p_member_id INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
  DECLARE v_total DECIMAL(10,2);

  SELECT COALESCE(SUM(fine_amount), 0)
    INTO v_total
    FROM Fine_Record
   WHERE member_id = p_member_id;

  RETURN v_total;
END$$

DELIMITER ;

-- =====================================================================
--  SAMPLE DATA
--  Dates are relative to today (CURDATE()), so overdue books and fines
--  always show up whenever you run this script.
-- =====================================================================

INSERT INTO Author (name, biography) VALUES
('Chetan Bhagat',        'Indian author and columnist known for popular campus novels such as Five Point Someone.'),
('R. K. Narayan',        'Indian novelist who created the fictional town of Malgudi, setting of many of his stories.'),
('Arundhati Roy',        'Indian author and activist; her novel The God of Small Things won the Booker Prize in 1997.'),
('Robert C. Martin',     'Software engineer and author, widely known as Uncle Bob, who writes about clean code and craftsmanship.'),
('Thomas H. Cormen',     'Computer scientist and professor; lead author of the textbook Introduction to Algorithms.'),
('Yuval Noah Harari',    'Israeli historian and author of Sapiens and Homo Deus.'),
('A. P. J. Abdul Kalam', 'Aerospace scientist and former President of India; author of Wings of Fire.'),
('Ruskin Bond',          'Indian author of British descent, famous for children''s stories and tales of the Himalayan foothills.');

-- available_copies already reflects the books that are currently borrowed below
INSERT INTO Book (title, isbn, author_id, category, publication_year, available_copies) VALUES
('Five Point Someone',                   '9788129104595', 1, 'Fiction',          2004, 4),
('Malgudi Days',                         '9780143039655', 2, 'Fiction',          1943, 3),
('The God of Small Things',              '9780006550686', 3, 'Fiction',          1997, 3),
('Clean Code',                           '9780132350884', 4, 'Technology',       2008, 3),
('Introduction to Algorithms',           '9780262046305', 5, 'Computer Science', 2022, 2),
('Sapiens: A Brief History of Humankind','9780099590088', 6, 'History',          2011, 3),
('Wings of Fire',                        '9788173711466', 7, 'Biography',        1999, 4),
('The Blue Umbrella',                    '9788171676835', 8, 'Fiction',          1980, 3),
('The Clean Coder',                      '9780137081073', 4, 'Technology',       2011, 0),
('Homo Deus',                            '9781784703936', 6, 'History',          2015, 3),
('The Guide',                            '9780143039648', 2, 'Fiction',          1958, 2),
('Ignited Minds',                        '9780143033820', 7, 'Self-Help',        2002, 4);

INSERT INTO Member (name, email, phone, registration_date) VALUES
('Aarav Sharma', 'aarav.sharma@example.com', '9876543210', '2026-01-12'),
('Priya Singh',  'priya.singh@example.com',  '9876501234', '2026-02-03'),
('Rohan Kumar',  'rohan.kumar@example.com',  '9123456780', '2026-02-20'),
('Sneha Verma',  'sneha.verma@example.com',  '9988776655', '2026-03-15'),
('Vikram Yadav', 'vikram.yadav@example.com', '9090909090', '2026-04-01'),
('Anjali Gupta', 'anjali.gupta@example.com', '8887766554', '2026-05-18'),
('Rahul Mishra', 'rahul.mishra@example.com', '7001234567', '2026-06-25'),
('Neha Kumari',  'neha.kumari@example.com',  '9555512345', '2026-08-09');

-- Borrowing records: (member_id, book_id, issue_date, due_date, return_date)
-- Loan period is 14 days, so due_date = issue_date + 14 days.
INSERT INTO Borrow_Log (member_id, book_id, issue_date, due_date, return_date) VALUES
-- Already returned: some late (will get fines below), some on time
(5, 3,  DATE_SUB(CURDATE(), INTERVAL 70 DAY), DATE_SUB(CURDATE(), INTERVAL 56 DAY), DATE_SUB(CURDATE(), INTERVAL 46 DAY)),
(7, 12, DATE_SUB(CURDATE(), INTERVAL 60 DAY), DATE_SUB(CURDATE(), INTERVAL 46 DAY), DATE_SUB(CURDATE(), INTERVAL 43 DAY)),
(3, 8,  DATE_SUB(CURDATE(), INTERVAL 50 DAY), DATE_SUB(CURDATE(), INTERVAL 36 DAY), DATE_SUB(CURDATE(), INTERVAL 32 DAY)),
(1, 11, DATE_SUB(CURDATE(), INTERVAL 45 DAY), DATE_SUB(CURDATE(), INTERVAL 31 DAY), DATE_SUB(CURDATE(), INTERVAL 30 DAY)),
(2, 3,  DATE_SUB(CURDATE(), INTERVAL 40 DAY), DATE_SUB(CURDATE(), INTERVAL 26 DAY), DATE_SUB(CURDATE(), INTERVAL 20 DAY)),
(6, 10, DATE_SUB(CURDATE(), INTERVAL 35 DAY), DATE_SUB(CURDATE(), INTERVAL 21 DAY), DATE_SUB(CURDATE(), INTERVAL 15 DAY)),
(4, 9,  DATE_SUB(CURDATE(), INTERVAL 25 DAY), DATE_SUB(CURDATE(), INTERVAL 11 DAY), DATE_SUB(CURDATE(), INTERVAL 12 DAY)),
-- Currently borrowed (return_date is NULL); three of them are overdue
(3, 5,  DATE_SUB(CURDATE(), INTERVAL 30 DAY), DATE_SUB(CURDATE(), INTERVAL 16 DAY), NULL),
(2, 1,  DATE_SUB(CURDATE(), INTERVAL 20 DAY), DATE_SUB(CURDATE(), INTERVAL 6 DAY),  NULL),
(5, 2,  DATE_SUB(CURDATE(), INTERVAL 18 DAY), DATE_SUB(CURDATE(), INTERVAL 4 DAY),  NULL),
(1, 6,  DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY),  NULL),
(1, 4,  DATE_SUB(CURDATE(), INTERVAL 5 DAY),  DATE_ADD(CURDATE(), INTERVAL 9 DAY),  NULL),
(4, 7,  DATE_SUB(CURDATE(), INTERVAL 3 DAY),  DATE_ADD(CURDATE(), INTERVAL 11 DAY), NULL),
(7, 9,  DATE_SUB(CURDATE(), INTERVAL 2 DAY),  DATE_ADD(CURDATE(), INTERVAL 12 DAY), NULL),
(8, 9,  DATE_SUB(CURDATE(), INTERVAL 1 DAY),  DATE_ADD(CURDATE(), INTERVAL 13 DAY), NULL);

-- Fines for every late return:  overdue days x Rs. 5 per day
INSERT INTO Fine_Record (member_id, book_id, issue_date, overdue_days, fine_amount)
SELECT member_id,
       book_id,
       issue_date,
       DATEDIFF(return_date, due_date),
       DATEDIFF(return_date, due_date) * 5
  FROM Borrow_Log
 WHERE return_date IS NOT NULL
   AND return_date > due_date;

-- Two of those fines have already been paid
UPDATE Fine_Record
   SET status = 'Paid', paid_date = DATE_SUB(CURDATE(), INTERVAL 30 DAY)
 WHERE member_id = 3 AND book_id = 8;

UPDATE Fine_Record
   SET status = 'Paid', paid_date = DATE_SUB(CURDATE(), INTERVAL 40 DAY)
 WHERE member_id = 7 AND book_id = 12;

-- ---------------------------------------------------------------------
-- Quick checks you can run after the script (expected values in comments)
--   SELECT get_total_fines(5);                            -- 50.00
--   SELECT get_total_fines(2);                            -- 30.00
--   SELECT COALESCE(SUM(fine_amount),0) FROM Fine_Record WHERE status='Unpaid';  -- 110.00
-- ---------------------------------------------------------------------
