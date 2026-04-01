"""
MoneyBook — Database Layer
==========================
SQLite-backed store for retail financial data.

Tables:
  stores              — one row per WhatsApp number, holds bot conversation state
  transactions        — every financial entry (with tag + confirmation status)
  udhaar              — running credit balance per person
  udhaar_transactions — individual credit/debit events per person
  persons             — person registry: staff / customer / supplier / home
"""

import sqlite3
import os
import json
from datetime import date, timedelta
from contextlib import contextmanager
from typing import Optional
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=True)

_BASE   = os.path.join(os.path.dirname(__file__), '..', '.tmp')
DB_PATH = os.getenv('DB_PATH', os.path.join(_BASE, 'moneybook.db'))


# ─────────────────────────────────────────────
# Connection
# ─────────────────────────────────────────────

@contextmanager
def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Schema + Migration
# ─────────────────────────────────────────────

def init_db():
    """Create all tables. Safe to run multiple times (idempotent)."""
    os.makedirs(_BASE, exist_ok=True)
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS stores (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                name              TEXT,
                phone             TEXT UNIQUE NOT NULL,
                language          TEXT DEFAULT 'auto',
                onboarding_state  TEXT DEFAULT 'new',
                bot_state         TEXT DEFAULT '{}',
                created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id     INTEGER NOT NULL,
                date         DATE    NOT NULL,
                type         TEXT    NOT NULL,
                amount       REAL    NOT NULL,
                description  TEXT,
                tag          TEXT,                   -- auto-suggested category tag
                person_name  TEXT,
                person_category TEXT,               -- staff|customer|supplier|home|other
                payment_mode TEXT,
                raw_message  TEXT,
                source       TEXT DEFAULT 'text',
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (store_id) REFERENCES stores (id)
            );

            CREATE TABLE IF NOT EXISTS udhaar (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id              INTEGER NOT NULL,
                person_name           TEXT    NOT NULL,
                phone                 TEXT,
                balance               REAL    DEFAULT 0,
                last_transaction_date DATE,
                created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (store_id) REFERENCES stores (id),
                UNIQUE (store_id, person_name COLLATE NOCASE)
            );

            CREATE TABLE IF NOT EXISTS udhaar_transactions (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                udhaar_id      INTEGER NOT NULL,
                transaction_id INTEGER,
                amount         REAL    NOT NULL,
                type           TEXT    NOT NULL,
                date           DATE    NOT NULL,
                notes          TEXT,
                created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (udhaar_id)      REFERENCES udhaar (id),
                FOREIGN KEY (transaction_id) REFERENCES transactions (id)
            );

            -- Person registry: remembers who each named person is
            CREATE TABLE IF NOT EXISTS persons (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id    INTEGER NOT NULL,
                name        TEXT    NOT NULL,
                category    TEXT    NOT NULL,  -- staff|customer|supplier|home|other
                notes       TEXT,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (store_id) REFERENCES stores (id),
                UNIQUE (store_id, name COLLATE NOCASE)
            );

            -- Correction log: every time owner fixes a parse error
            -- Used as few-shot examples in future prompts (per-store learning)
            CREATE TABLE IF NOT EXISTS store_corrections (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id        INTEGER NOT NULL,
                raw_text        TEXT,           -- what the AI originally read/said
                original_json   TEXT,           -- AI's original parsed transaction (JSON)
                corrected_json  TEXT NOT NULL,  -- what the owner said it actually is (JSON)
                entry_index     INTEGER,        -- which entry number was corrected (1-based)
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (store_id) REFERENCES stores (id)
            );

            -- Web app chat message history (separate from WhatsApp channel)
            CREATE TABLE IF NOT EXISTS web_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id    INTEGER NOT NULL,
                direction   TEXT    NOT NULL,   -- 'user' | 'bot'
                body        TEXT,               -- text content
                media_url   TEXT,               -- relative path for uploaded images
                quick_replies TEXT DEFAULT '[]',-- JSON array of quick reply strings
                metadata    TEXT,               -- JSON object with pending_transactions etc.
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (store_id) REFERENCES stores (id)
            );
            CREATE INDEX IF NOT EXISTS idx_web_messages_store
                ON web_messages (store_id, created_at);
        """)
        _migrate(conn)
    print(f"✅ Database ready: {DB_PATH}")


def _migrate(conn):
    """Add columns to existing tables if they were created before schema updates."""
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN bot_state TEXT DEFAULT '{}'")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN tag TEXT")
    _try_alter(conn, "ALTER TABLE transactions ADD COLUMN person_category TEXT")
    # 3-tier learning system (2026-03-28)
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN segment TEXT DEFAULT 'general'")
    _try_alter(conn, "ALTER TABLE stores ADD COLUMN onboarding_state TEXT DEFAULT 'new'")
    _try_alter(conn, "ALTER TABLE store_corrections ADD COLUMN scope TEXT DEFAULT 'store'")
    _try_alter(conn, "ALTER TABLE store_corrections ADD COLUMN segment TEXT")
    _try_alter(conn, "ALTER TABLE store_corrections ADD COLUMN confidence INTEGER DEFAULT 1")
    # Inline transaction editing (2026-03-28)
    _try_alter(conn, "ALTER TABLE web_messages ADD COLUMN metadata TEXT")


def _try_alter(conn, sql: str):
    try:
        conn.execute(sql)
    except Exception:
        pass   # Column already exists — safe to ignore


# ─────────────────────────────────────────────
# Data Migrations
# ─────────────────────────────────────────────

def migrate_fix_negative_udhaar():
    """Fix udhaar records where balance is negative due to wrong column usage in ledger.

    When users entered 'Sanjiv owes me ₹12000' in the left/Dues-Received column,
    the system created dues_received (balance -12000). Since those users intended
    'this person owes us', we flip the balance and transaction types so the record
    shows correctly in the Dues & Staff tab.

    Safe to run multiple times — only touches records where balance < 0.
    """
    import logging
    log = logging.getLogger(__name__)
    with get_db() as conn:
        neg_rows = conn.execute(
            "SELECT id, store_id, person_name, balance FROM udhaar WHERE balance < 0"
        ).fetchall()

        for u in neg_rows:
            uid       = u['id']
            abs_bal   = abs(u['balance'])
            log.info(f"[migration] Fixing udhaar {uid} ({u['person_name']}): {u['balance']} → {abs_bal}")

            # Flip udhaar balance to positive
            conn.execute("UPDATE udhaar SET balance = ? WHERE id = ?", (abs_bal, uid))

            # Flip udhaar_transactions: received↔given
            conn.execute("""
                UPDATE udhaar_transactions
                SET type = CASE type
                    WHEN 'received' THEN 'given'
                    WHEN 'given'    THEN 'received'
                    ELSE type END
                WHERE udhaar_id = ?
            """, (uid,))

            # Flip the underlying transaction type in transactions table
            txn_ids = conn.execute(
                "SELECT transaction_id FROM udhaar_transactions WHERE udhaar_id = ? AND transaction_id IS NOT NULL",
                (uid,)
            ).fetchall()
            for row in txn_ids:
                tid = row['transaction_id']
                conn.execute("""
                    UPDATE transactions
                    SET type = CASE type
                        WHEN 'dues_received'   THEN 'dues_given'
                        WHEN 'dues_given'      THEN 'dues_received'
                        WHEN 'udhaar_received' THEN 'udhaar_given'
                        WHEN 'udhaar_given'    THEN 'udhaar_received'
                        ELSE type END
                    WHERE id = ?
                """, (tid,))


def migrate_clean_dues_given_names():
    """Fix dues_given rows where person_name/description were set to the full description text.

    e.g. person_name = 'Dues received from Sanjiv Mishra' → 'Sanjiv Mishra'
         description  = 'Dues received from Sanjiv Mishra' → 'Dues given to Sanjiv Mishra'

    Safe to run multiple times.
    """
    import re, logging
    log = logging.getLogger(__name__)
    with get_db() as conn:
        def _looks_like_sentence(val):
            """Returns True if val is a full description rather than a clean person name."""
            if not val: return False
            words = val.strip().split()
            if len(words) > 3: return True
            if re.search(r'\b(dues|given|received|from|dated|amount|paisa|udhaar)\b', val, re.IGNORECASE): return True
            return False

        def _extract_person(raw):
            # No IGNORECASE so [A-Z] only matches uppercase — stops at "dated" (lowercase d)
            m = re.search(r'\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', raw)
            if m: return m.group(1).strip()
            # Fallback: strip leading keywords and take remaining capitalised words
            stripped = re.sub(r'^(dues\s+)?(given|received)\s+(to|from)\s+', '', raw, flags=re.IGNORECASE).strip()
            stripped = re.sub(r'\s+dated\s+.*$', '', stripped, flags=re.IGNORECASE).strip()
            if stripped and len(stripped.split()) <= 4: return stripped
            return None

        # Fix transactions — any dues type where person_name looks like a sentence
        rows = conn.execute("""
            SELECT id, type, person_name, description FROM transactions
            WHERE type IN ('dues_given', 'udhaar_given', 'dues_received', 'udhaar_received')
        """).fetchall()

        for row in rows:
            pname = row['person_name'] or ''
            desc  = row['description'] or ''
            if not _looks_like_sentence(pname):
                continue
            clean_name = _extract_person(pname) or _extract_person(desc)
            if not clean_name:
                continue
            # Also fix description if it's a sentence
            clean_desc = desc
            if _looks_like_sentence(desc):
                if row['type'] in ('dues_given', 'udhaar_given'):
                    clean_desc = re.sub(r'\breceived\b', 'given', desc, flags=re.IGNORECASE)
                    clean_desc = re.sub(r'\bfrom\b', 'to', clean_desc, flags=re.IGNORECASE)
                    clean_desc = re.sub(r'\s+dated\s+.*$', '', clean_desc, flags=re.IGNORECASE).strip()
                else:
                    clean_desc = re.sub(r'\bgiven\b', 'received', desc, flags=re.IGNORECASE)
                    clean_desc = re.sub(r'\bto\b', 'from', clean_desc, flags=re.IGNORECASE)
                    clean_desc = re.sub(r'\s+dated\s+.*$', '', clean_desc, flags=re.IGNORECASE).strip()
            conn.execute(
                "UPDATE transactions SET person_name = ?, description = ? WHERE id = ?",
                (clean_name, clean_desc, row['id'])
            )
            log.info(f"[migration] Fixed txn {row['id']}: person_name='{clean_name}' desc='{clean_desc}'")

        # Fix udhaar table where person_name is a full sentence
        udhaar_rows = conn.execute("SELECT id, person_name FROM udhaar").fetchall()
        for row in udhaar_rows:
            if not _looks_like_sentence(row['person_name']):
                continue
            clean_name = _extract_person(row['person_name'])
            if clean_name:
                conn.execute("UPDATE udhaar SET person_name = ? WHERE id = ?", (clean_name, row['id']))
                log.info(f"[migration] Fixed udhaar {row['id']}: '{row['person_name']}' → '{clean_name}'")


def migrate_backfill_dues_person_name():
    """Backfill person_name on dues_received/udhaar_received transactions where it is NULL.

    When the ledger saved dues rows without person_name (old bug), the description
    often contains the person's name (e.g. 'Amount received from Sanjiv Mishra dated 2-1-26').
    This migration extracts the name from common description patterns and sets person_name.

    Safe to run multiple times — only touches rows where person_name IS NULL.
    """
    import re, logging
    log = logging.getLogger(__name__)
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, description FROM transactions
            WHERE type IN ('dues_received','udhaar_received')
              AND (person_name IS NULL OR person_name = '')
              AND description IS NOT NULL AND description != ''
        """).fetchall()

        fixed = 0
        for row in rows:
            desc = row['description']
            # Pattern 1: "... from <Name> dated ..."  or  "... from <Name>"
            m = re.search(r'\bfrom\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', desc)
            if not m:
                # Pattern 2: description IS just a person name (short, no keywords)
                stripped = desc.strip()
                if stripped and len(stripped.split()) <= 4 and not any(
                    kw in stripped.lower() for kw in ['received','paid','dues','amount','rs','₹']
                ):
                    m = type('m', (), {'group': lambda self, n: stripped})()
            if m:
                person = m.group(1).strip()
                conn.execute(
                    "UPDATE transactions SET person_name = ? WHERE id = ?",
                    (person, row['id'])
                )
                log.info(f"[migration] Backfilled person_name='{person}' on txn {row['id']}")
                fixed += 1

        if fixed:
            log.info(f"[migration] backfill_dues_person_name: fixed {fixed} rows")


# ─────────────────────────────────────────────
# Store operations
# ─────────────────────────────────────────────

def get_store_by_phone(phone: str):
    """Read-only lookup — returns store dict or None if not found."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM stores WHERE phone = ?", (phone,)).fetchone()
        return dict(row) if row else None


def get_or_create_store(phone: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM stores WHERE phone = ?", (phone,)).fetchone()
        if not row:
            conn.execute(
                "INSERT INTO stores (phone, onboarding_state, bot_state) VALUES (?, 'new', '{}')",
                (phone,)
            )
            row = conn.execute("SELECT * FROM stores WHERE phone = ?", (phone,)).fetchone()
        return dict(row)


def update_store(store_id: int, **kwargs):
    if not kwargs:
        return
    cols = ', '.join(f"{k} = ?" for k in kwargs)
    with get_db() as conn:
        conn.execute(f"UPDATE stores SET {cols} WHERE id = ?",
                     list(kwargs.values()) + [store_id])


def get_all_active_stores() -> list:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM stores WHERE onboarding_state = 'active'"
        ).fetchall()]


# ─────────────────────────────────────────────
# Bot state (conversation state machine)
# ─────────────────────────────────────────────

def get_bot_state(store_id: int) -> dict:
    """Load current conversation state for this store."""
    with get_db() as conn:
        row = conn.execute("SELECT bot_state FROM stores WHERE id = ?", (store_id,)).fetchone()
        try:
            return json.loads(row['bot_state'] or '{}')
        except Exception:
            return {}


def set_bot_state(store_id: int, state: dict):
    """Persist conversation state."""
    update_store(store_id, bot_state=json.dumps(state, ensure_ascii=False))


def clear_bot_state(store_id: int):
    """Reset to idle."""
    update_store(store_id, bot_state='{}')


# ─────────────────────────────────────────────
# Person registry
# ─────────────────────────────────────────────

def get_person(store_id: int, name: str) -> Optional[dict]:
    """Look up a known person. Case-insensitive."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM persons WHERE store_id = ? AND name = ? COLLATE NOCASE",
            (store_id, name)
        ).fetchone()
        return dict(row) if row else None


def save_person(store_id: int, name: str, category: str, notes: str = None):
    """Remember a person's category (upsert) and backfill existing transactions."""
    with get_db() as conn:
        conn.execute("""
            INSERT INTO persons (store_id, name, category, notes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(store_id, name) DO UPDATE SET category=excluded.category
        """, (store_id, name, category, notes))
        # Backfill person_category on existing transactions for this person
        conn.execute("""
            UPDATE transactions SET person_category = ?
            WHERE store_id = ? AND person_name = ? COLLATE NOCASE
              AND person_category IS NULL
        """, (category, store_id, name))


def get_unknown_persons(store_id: int, names: list) -> list:
    """From a list of names, return those not yet in the persons registry."""
    unknown = []
    for name in names:
        if name and not get_person(store_id, name):
            unknown.append(name)
    return unknown


# ─────────────────────────────────────────────
# Transaction operations
# ─────────────────────────────────────────────

def add_transaction(store_id: int, txn: dict,
                    raw_message: str = None, source: str = 'text') -> int:
    """Insert a confirmed transaction. Updates udhaar automatically.
    Deduplicates: skips if an identical (store, date, type, amount) entry was saved
    within the last 10 minutes — prevents double-saves from double-confirms.
    """
    txn_date = txn.get('date') or date.today().isoformat()

    # Lookup known person category if not provided
    person_cat = txn.get('person_category')
    if not person_cat and txn.get('person_name'):
        known = get_person(store_id, txn['person_name'])
        if known:
            person_cat = known['category']

    with get_db() as conn:
        # Deduplication check — same store + date + type + amount saved in last 10 min
        recent_dup = conn.execute("""
            SELECT id FROM transactions
            WHERE store_id = ? AND date = ? AND type = ? AND amount = ?
              AND created_at >= datetime('now', '-10 minutes')
            LIMIT 1
        """, (store_id, txn_date, txn['type'], float(txn['amount']))).fetchone()
        if recent_dup:
            return recent_dup['id']   # already saved, skip silently

        cursor = conn.execute("""
            INSERT INTO transactions
                (store_id, date, type, amount, description, tag,
                 person_name, person_category, payment_mode, raw_message, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            store_id, txn_date, txn['type'], float(txn['amount']),
            txn.get('description'), txn.get('tag'),
            txn.get('person_name'), person_cat,
            txn.get('payment_mode'), raw_message, source,
        ))
        txn_id = cursor.lastrowid

        if txn['type'] in ('udhaar_given', 'udhaar_received', 'dues_given', 'dues_received') and txn.get('person_name'):
            _update_udhaar(conn, store_id, txn, txn_id, txn_date)

    return txn_id


def _update_udhaar(conn, store_id: int, txn: dict, txn_id: int, txn_date: str):
    person = txn['person_name']
    amount = float(txn['amount'])

    row = conn.execute(
        "SELECT * FROM udhaar WHERE store_id = ? AND person_name = ? COLLATE NOCASE",
        (store_id, person)
    ).fetchone()

    if not row:
        conn.execute(
            "INSERT INTO udhaar (store_id, person_name, balance, last_transaction_date) "
            "VALUES (?, ?, 0, ?)", (store_id, person, txn_date)
        )
        row = conn.execute(
            "SELECT * FROM udhaar WHERE store_id = ? AND person_name = ? COLLATE NOCASE",
            (store_id, person)
        ).fetchone()

    uid = row['id']
    delta = amount if txn['type'] in ('udhaar_given', 'dues_given') else -amount
    ut    = 'given' if txn['type'] in ('udhaar_given', 'dues_given') else 'received'

    conn.execute(
        "UPDATE udhaar SET balance = balance + ?, last_transaction_date = ? WHERE id = ?",
        (delta, txn_date, uid)
    )
    conn.execute(
        "INSERT INTO udhaar_transactions (udhaar_id, transaction_id, amount, type, date) "
        "VALUES (?, ?, ?, ?, ?)",
        (uid, txn_id, amount, ut, txn_date)
    )


# ─────────────────────────────────────────────
# Summaries & reporting
# ─────────────────────────────────────────────

def get_daily_summary(store_id: int, for_date: str = None) -> dict:
    if not for_date:
        for_date = date.today().isoformat()
    with get_db() as conn:
        # If no data for requested date, fall back to most recent date with data
        has_data = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE store_id = ? AND date = ?",
            (store_id, for_date)
        ).fetchone()[0]
        if not has_data:
            latest = conn.execute(
                "SELECT date FROM transactions WHERE store_id = ? ORDER BY date DESC LIMIT 1",
                (store_id,)
            ).fetchone()
            if latest:
                for_date = latest[0]   # use most recent date that has data
        # Totals by transaction type
        agg = conn.execute("""
            SELECT type, SUM(amount) AS total, COUNT(*) AS count
            FROM transactions WHERE store_id = ? AND date = ?
            GROUP BY type
        """, (store_id, for_date)).fetchall()

        # Expense breakdown by tag (for detailed category view)
        expense_tags = conn.execute("""
            SELECT COALESCE(NULLIF(tag, ''), 'uncategorized') AS tag, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date = ? AND type = 'expense'
            GROUP BY COALESCE(NULLIF(tag, ''), 'uncategorized')
            ORDER BY total DESC
        """, (store_id, for_date)).fetchall()

        detail = conn.execute("""
            SELECT * FROM transactions WHERE store_id = ? AND date = ?
            ORDER BY created_at ASC
        """, (store_id, for_date)).fetchall()

    return {
        'date':         for_date,
        'summary':      {r['type']: {'total': r['total'], 'count': r['count']} for r in agg},
        'expense_tags': {r['tag']: r['total'] for r in expense_tags},
        'transactions': [dict(t) for t in detail],
    }


def get_period_summary(store_id: int, start_date: str, end_date: str, label: str = '') -> dict:
    """Aggregated summary for any date range (monthly / quarterly / yearly)."""
    with get_db() as conn:
        # Totals by type
        agg = conn.execute("""
            SELECT type, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ?
            GROUP BY type
        """, (store_id, start_date, end_date)).fetchall()

        # Operating expense breakdown by tag (exclude staff tags)
        expense_tags = conn.execute("""
            SELECT COALESCE(NULLIF(tag, ''), 'uncategorized') AS tag, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type = 'expense'
              AND COALESCE(tag, '') NOT IN ('staff_salary', 'staff_expense', 'staff expense')
            GROUP BY COALESCE(NULLIF(tag, ''), 'uncategorized')
            ORDER BY total DESC
        """, (store_id, start_date, end_date)).fetchall()

        # Staff expense breakdown (staff tags only)
        staff_expense_tags = conn.execute("""
            SELECT COALESCE(NULLIF(tag, ''), 'staff_expense') AS tag, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type = 'expense'
              AND COALESCE(tag, '') IN ('staff_salary', 'staff_expense', 'staff expense')
            GROUP BY COALESCE(NULLIF(tag, ''), 'staff_expense')
            ORDER BY total DESC
        """, (store_id, start_date, end_date)).fetchall()

        # Staff expense total: expenses minus receipts (money returned by staff)
        staff_exp_row = conn.execute("""
            SELECT SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END)
                 - SUM(CASE WHEN type = 'receipt' THEN amount ELSE 0 END) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ?
              AND COALESCE(tag, '') IN ('staff_salary', 'staff_expense', 'staff expense')
        """, (store_id, start_date, end_date)).fetchone()

        # Operating expense total (non-staff = everything else with type expense)
        op_exp_row = conn.execute("""
            SELECT SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type = 'expense'
              AND COALESCE(tag, '') NOT IN ('staff_salary', 'staff_expense', 'staff expense')
        """, (store_id, start_date, end_date)).fetchone()

        # Dues given and received in the period (supports both old and new type names)
        udhaar_given_row = conn.execute("""
            SELECT SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type IN ('udhaar_given', 'dues_given')
        """, (store_id, start_date, end_date)).fetchone()

        udhaar_received_row = conn.execute("""
            SELECT SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type IN ('udhaar_received', 'dues_received')
        """, (store_id, start_date, end_date)).fetchone()

        # Daily sales trend (for context)
        daily = conn.execute("""
            SELECT date, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ? AND type = 'sale'
            GROUP BY date ORDER BY date ASC
        """, (store_id, start_date, end_date)).fetchall()

    return {
        'label':              label,
        'start':              start_date,
        'end':                end_date,
        'summary':            {r['type']: r['total'] for r in agg},
        'expense_tags':       {r['tag']: r['total'] for r in expense_tags},
        'staff_expense_tags': {r['tag']: r['total'] for r in staff_expense_tags},
        'staff_expense':      staff_exp_row['total'] or 0.0,
        'operating_expense':  op_exp_row['total'] or 0.0,
        'udhaar_given_period':    udhaar_given_row['total'] or 0.0,
        'udhaar_received_period': udhaar_received_row['total'] or 0.0,
        'daily_sales':        [dict(r) for r in daily],
    }


def get_weekly_summary(store_id: int) -> dict:
    end   = date.today().isoformat()
    start = (date.today() - timedelta(days=6)).isoformat()
    return get_period_summary(store_id, start, end, label='Weekly')


def get_udhaar_outstanding(store_id: int) -> list:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM udhaar WHERE store_id = ? AND balance > 0 ORDER BY balance DESC",
            (store_id,)
        ).fetchall()]


def get_udhaar_aging(store_id: int, days: int = 30) -> list:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with get_db() as conn:
        return [dict(r) for r in conn.execute("""
            SELECT * FROM udhaar
            WHERE store_id = ? AND balance > 0 AND last_transaction_date <= ?
            ORDER BY last_transaction_date ASC
        """, (store_id, cutoff)).fetchall()]


def get_all_transactions(store_id: int, start: str = None, end: str = None) -> list:
    if not start:
        start = (date.today() - timedelta(days=30)).isoformat()
    if not end:
        end = date.today().isoformat()
    with get_db() as conn:
        return [dict(r) for r in conn.execute("""
            SELECT * FROM transactions WHERE store_id = ? AND date BETWEEN ? AND ?
            ORDER BY date DESC, created_at DESC
        """, (store_id, start, end)).fetchall()]


def get_all_udhaar(store_id: int) -> list:
    with get_db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM udhaar WHERE store_id = ? ORDER BY balance DESC", (store_id,)
        ).fetchall()]


# ─────────────────────────────────────────────
# Correction learning
# ─────────────────────────────────────────────

def get_store_segment(store_id: int) -> str:
    """Return the business segment for this store (textile/grocery/pharmacy/etc.)"""
    with get_db() as conn:
        row = conn.execute("SELECT segment FROM stores WHERE id = ?", (store_id,)).fetchone()
        return (row['segment'] or 'general') if row else 'general'


def save_correction(store_id: int, raw_text: str,
                    original_json: dict, corrected_json: dict,
                    entry_index: int = None,
                    scope: str = 'store',
                    segment: str = None,
                    confidence: int = 1):
    """
    Log a correction the owner made.
    scope: 'store' | 'segment' | 'global'
      - store:   only this store (person names, local abbreviations)
      - segment: all stores in same business type (textile vocab, pharmacy terms)
      - global:  every store (UPI spelling, payment methods, CD = cash discount)
    confidence: how many stores confirmed this pattern (incremented by promote_correction)
    """
    with get_db() as conn:
        conn.execute("""
            INSERT INTO store_corrections
                (store_id, raw_text, original_json, corrected_json,
                 entry_index, scope, segment, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            store_id,
            raw_text,
            json.dumps(original_json, ensure_ascii=False),
            json.dumps(corrected_json, ensure_ascii=False),
            entry_index,
            scope,
            segment,
            confidence,
        ))


def promote_correction(store_id: int, corrected_json: dict,
                       target_scope: str, target_segment: str = None):
    """
    When multiple stores make the same correction, promote it to a wider scope.
    - 2 stores correct same thing  → promote store→segment
    - 5+ stores correct same thing → promote segment→global
    This is how the system gets smarter over time without manual curation.
    """
    corr_str = json.dumps(corrected_json, sort_keys=True, ensure_ascii=False)
    with get_db() as conn:
        # Find existing corrections with same corrected JSON across different stores
        rows = conn.execute("""
            SELECT id, scope, confidence
            FROM store_corrections
            WHERE corrected_json = ? AND store_id != ?
            ORDER BY confidence DESC LIMIT 1
        """, (corr_str, store_id)).fetchall()

        if rows:
            # Increment confidence on the most-seen version
            conn.execute("""
                UPDATE store_corrections
                SET scope = ?, segment = ?, confidence = confidence + 1
                WHERE id = ?
            """, (target_scope, target_segment, rows[0]['id']))


def get_corrections_by_scope(scope: str,
                              store_id: int = None,
                              segment: str = None,
                              limit: int = 10) -> list:
    """
    Fetch corrections filtered by scope tier.
    - scope='global':  highest-confidence universal corrections
    - scope='segment': corrections for a specific business type
    - scope='store':   corrections for a specific store
    Returns ordered by confidence DESC, then recency DESC.
    """
    with get_db() as conn:
        if scope == 'global':
            rows = conn.execute("""
                SELECT raw_text, original_json, corrected_json, confidence
                FROM store_corrections
                WHERE scope = 'global'
                ORDER BY confidence DESC, created_at DESC
                LIMIT ?
            """, (limit,)).fetchall()

        elif scope == 'segment' and segment and segment != 'general':
            rows = conn.execute("""
                SELECT raw_text, original_json, corrected_json, confidence
                FROM store_corrections
                WHERE scope = 'segment' AND segment = ?
                ORDER BY confidence DESC, created_at DESC
                LIMIT ?
            """, (segment, limit)).fetchall()

        elif scope == 'store' and store_id:
            rows = conn.execute("""
                SELECT raw_text, original_json, corrected_json, confidence
                FROM store_corrections
                WHERE scope = 'store' AND store_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (store_id, limit)).fetchall()
        else:
            rows = []

        return [dict(r) for r in rows]


def _format_correction_line(c: dict) -> str:
    """Format one correction row as a prompt-ready bullet point."""
    try:
        orig = json.loads(c['original_json'])
        corr = json.loads(c['corrected_json'])
        orig_desc = orig.get('description') or orig.get('raw_text') or '?'
        parts = []
        if corr.get('type'):  parts.append(f"type:{corr['type']}")
        if corr.get('tag'):   parts.append(f"tag:{corr['tag']}")
        if corr.get('description') and corr['description'] != orig_desc:
            parts.append(f'desc:"{corr["description"]}"')
        if corr.get('person_name'):  parts.append(f"person:{corr['person_name']}")
        if corr.get('amount'):       parts.append(f"amount:{corr['amount']}")
        return f'  • "{orig_desc}" → {", ".join(parts)}'
    except Exception:
        return ''


def build_store_context(store_id: int) -> str:
    """
    Build a 3-tier learning context string injected into every parser prompt.

    Tier 1 — GLOBAL:  universal corrections (UPI spelling, CD=Cash Discount, etc.)
                       applies to every store
    Tier 2 — SEGMENT: industry-specific vocabulary (textile, grocery, pharmacy, etc.)
                       applies to all stores in same segment
    Tier 3 — STORE:   this store's specific corrections (person names, local terms)
                       applies only here

    Why 3 tiers:
      • "OPI → UPI" is global — one store learned it, all stores benefit
      • "Palledari → freight" is textile-specific — textile stores share it, grocery stores don't
      • "Anup Tiwari → staff" is store-specific — never bleeds to other stores
    """
    segment = get_store_segment(store_id)

    # Pull from each tier with appropriate limits
    global_c  = get_corrections_by_scope('global',  limit=8)
    segment_c = get_corrections_by_scope('segment', segment=segment, limit=8)
    store_c   = get_corrections_by_scope('store',   store_id=store_id, limit=15)

    if not (global_c or segment_c or store_c):
        return ""

    sections = []

    if global_c:
        lines = ["🌐 Universal corrections (apply to all stores):"]
        lines += [_format_correction_line(c) for c in global_c if _format_correction_line(c)]
        sections.append('\n'.join(lines))

    if segment_c:
        segment_label = segment.title()
        lines = [f"🏪 {segment_label} store corrections (same business type):"]
        lines += [_format_correction_line(c) for c in segment_c if _format_correction_line(c)]
        sections.append('\n'.join(lines))

    if store_c:
        lines = ["🔒 This store only (do not apply elsewhere):"]
        lines += [_format_correction_line(c) for c in store_c if _format_correction_line(c)]
        sections.append('\n'.join(lines))

    return "📚 Learned corrections — apply these:\n\n" + '\n\n'.join(sections)


# Keep for backwards compatibility
def get_recent_corrections(store_id: int, limit: int = 15) -> list:
    return get_corrections_by_scope('store', store_id=store_id, limit=limit)


def get_store_expense_tags(store_id: int, limit: int = 15) -> list:
    """Return the most-used expense tags for this store, capped at `limit`."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT tag, COUNT(*) AS cnt
            FROM transactions
            WHERE store_id = ? AND type = 'expense'
              AND tag IS NOT NULL AND tag != ''
              AND tag NOT IN ('staff_salary', 'staff_expense', 'staff expense')
            GROUP BY tag
            ORDER BY cnt DESC
            LIMIT ?
        """, (store_id, limit)).fetchall()
        return [{'tag': r['tag'], 'count': r['cnt']} for r in rows]


# ─────────────────────────────────────────────
# Analytics helpers
# ─────────────────────────────────────────────

def get_daily_trend(store_id: int, start: str, end: str) -> list:
    """Returns list of {date, sales, expenses} for trend chart."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                date,
                SUM(CASE WHEN type = 'sale' THEN amount ELSE 0 END) AS sales,
                SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expenses
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date ASC
        """, (store_id, start, end)).fetchall()
        return [dict(r) for r in rows] if rows else []


def get_staff_payments(store_id: int, start: str, end: str) -> list:
    """Returns list of {person_name, total, count} for staff members.
    Net total = expenses paid to staff minus receipts from staff."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT t.person_name,
                   SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END)
                 - SUM(CASE WHEN t.type = 'receipt' THEN t.amount ELSE 0 END) AS total,
                   COUNT(*) AS count
            FROM transactions t
            INNER JOIN persons p ON p.store_id = t.store_id
                AND p.name = t.person_name COLLATE NOCASE
                AND p.category = 'staff'
            WHERE t.store_id = ? AND t.date BETWEEN ? AND ?
              AND t.type IN ('expense', 'receipt')
              AND t.person_name IS NOT NULL
              AND COALESCE(t.tag, '') IN ('staff_salary', 'staff_expense', 'staff expense')
            GROUP BY t.person_name
            ORDER BY total DESC
        """, (store_id, start, end)).fetchall()
        return [dict(r) for r in rows] if rows else []


def get_payment_mode_split(store_id: int, start: str, end: str) -> dict:
    """Returns {cash: X, upi: X, bank: X} totals for sales/receipts only."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT LOWER(COALESCE(payment_mode, 'cash')) AS mode, SUM(amount) AS total
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ?
              AND type IN ('sale', 'receipt')
            GROUP BY LOWER(COALESCE(payment_mode, 'cash'))
        """, (store_id, start, end)).fetchall()
        result = {'cash': 0.0, 'upi': 0.0, 'bank': 0.0}
        for r in rows:
            mode = r['mode'] if r['mode'] in ('cash', 'upi', 'bank') else 'cash'
            result[mode] = result.get(mode, 0.0) + (r['total'] or 0.0)
        return result


def get_top_receivers(store_id: int, start: str, end: str, limit: int = 5) -> list:
    """Returns top people who paid back udhaar (udhaar_received) in period."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT person_name, SUM(amount) AS total, COUNT(*) AS count
            FROM transactions
            WHERE store_id = ? AND date BETWEEN ? AND ?
              AND type IN ('udhaar_received', 'dues_received')
              AND person_name IS NOT NULL
            GROUP BY person_name
            ORDER BY total DESC
            LIMIT ?
        """, (store_id, start, end, limit)).fetchall()
        return [dict(r) for r in rows] if rows else []


def get_others_summary(store_id: int, start: str, end: str) -> list:
    """Returns transactions for people classified as 'other', grouped by person.
    Shows {person_name, total, count, types} so the analytics Others section
    can list each person with their transaction totals."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                t.person_name,
                SUM(t.amount) AS total,
                COUNT(*) AS count,
                GROUP_CONCAT(DISTINCT t.type) AS types
            FROM transactions t
            WHERE t.store_id = ? AND t.date BETWEEN ? AND ?
              AND t.person_category = 'other'
              AND t.person_name IS NOT NULL
            GROUP BY t.person_name
            ORDER BY total DESC
        """, (store_id, start, end)).fetchall()
        return [dict(r) for r in rows] if rows else []


# ─────────────────────────────────────────────
# Dues & Staff helpers
# ─────────────────────────────────────────────

def get_dues_with_detail(store_id: int) -> list:
    """Returns each udhaar person with balance, last date, recent transactions."""
    today = date.today()
    with get_db() as conn:
        udhaar_rows = conn.execute("""
            SELECT * FROM udhaar
            WHERE store_id = ? AND balance > 0
            ORDER BY balance DESC
        """, (store_id,)).fetchall()

        result = []
        for u in udhaar_rows:
            uid = u['id']
            # Calculate days overdue from last transaction
            last_date = u['last_transaction_date']
            days_overdue = 0
            if last_date:
                try:
                    days_overdue = (today - date.fromisoformat(last_date)).days
                except Exception:
                    days_overdue = 0

            # Get recent transactions from udhaar_transactions joined to transactions
            txn_rows = conn.execute("""
                SELECT ut.date, ut.amount, ut.type, t.description, t.payment_mode
                FROM udhaar_transactions ut
                LEFT JOIN transactions t ON ut.transaction_id = t.id
                WHERE ut.udhaar_id = ?
                ORDER BY ut.date DESC, ut.id DESC
                LIMIT 5
            """, (uid,)).fetchall()

            recent_txns = [dict(r) for r in txn_rows]

            # Total given and total received for this person (lifetime)
            totals = conn.execute("""
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'given'    THEN amount ELSE 0 END), 0) AS total_given,
                    COALESCE(SUM(CASE WHEN type = 'received' THEN amount ELSE 0 END), 0) AS total_received
                FROM udhaar_transactions WHERE udhaar_id = ?
            """, (uid,)).fetchone()

            result.append({
                'person_name':          u['person_name'],
                'phone':                u['phone'],
                'balance':              u['balance'],
                'last_transaction_date': last_date,
                'days_overdue':         days_overdue,
                'recent_transactions':  recent_txns,
                'total_given':          totals['total_given'],
                'total_received':       totals['total_received'],
            })
        return result


def _extract_name_from_desc(desc: str) -> str | None:
    """Extract a person name from a transaction description.

    Handles patterns like:
      'Amount received from Sanjiv Mishra dated 2-1-26' → 'Sanjiv Mishra'
      'Paisa mila Ramesh Kumar'                         → 'Ramesh Kumar'
    """
    import re
    if not desc:
        return None
    # Pattern: "from <Name>" where Name starts with capital
    m = re.search(r'\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', desc)
    if m:
        return m.group(1).strip()
    # Short description with no finance keywords = likely just a name
    stripped = desc.strip()
    if stripped and len(stripped.split()) <= 4 and not re.search(
        r'received|paid|dues|amount|paisa|mila|rs\.?|₹', stripped, re.IGNORECASE
    ):
        return stripped
    return None


def get_dues_received(store_id: int, start: str = None, end: str = None) -> list:
    """Returns payments received against dues, grouped by resolved person name.

    Includes transactions where person_name IS NULL by extracting the name
    from the description field. Groups all rows by the resolved name.
    Each row: person_name, total_received, last_date, txn_count, recent (last 5), net_pending.
    """
    with get_db() as conn:
        params = [store_id]
        date_filter = ""
        if start and end:
            date_filter = " AND date BETWEEN ? AND ?"
            params += [start, end]
        elif start:
            date_filter = " AND date >= ?"
            params.append(start)
        elif end:
            date_filter = " AND date <= ?"
            params.append(end)

        # Fetch ALL dues_received rows (including person_name IS NULL)
        all_rows = conn.execute(f"""
            SELECT id, person_name, amount, date, description
            FROM transactions
            WHERE store_id = ?
              AND type IN ('dues_received', 'udhaar_received')
              {date_filter}
            ORDER BY date DESC, id DESC
        """, params).fetchall()

        # Resolve name for each row, skip rows where name can't be determined
        from collections import defaultdict
        groups = defaultdict(list)
        for row in all_rows:
            name = row['person_name'] or _extract_name_from_desc(row['description'])
            if not name:
                continue
            groups[name].append(dict(row))

        result = []
        for name, txns in groups.items():
            total    = sum(t['amount'] for t in txns)
            last_d   = max(t['date'] for t in txns)
            recent   = txns[:5]  # already sorted DESC from query

            # Net pending from udhaar table
            udhaar_row = conn.execute(
                "SELECT balance FROM udhaar WHERE store_id = ? AND person_name = ? COLLATE NOCASE",
                (store_id, name)
            ).fetchone()
            net_pending = udhaar_row['balance'] if udhaar_row else 0

            # Date and total amount when dues were originally given to this person
            given_row = conn.execute("""
                SELECT MIN(date) AS first_given, SUM(amount) AS total_given
                FROM transactions
                WHERE store_id = ? AND type IN ('dues_given', 'udhaar_given')
                  AND person_name = ? COLLATE NOCASE
            """, (store_id, name)).fetchone()
            dues_given_date   = given_row['first_given']   if given_row else None
            dues_given_amount = given_row['total_given']   if given_row else None

            # Clean description for each recent txn (strip "dated X" suffix, extract plain text)
            clean_recent = []
            for txn in recent:
                d = dict(txn)
                desc = d.get('description') or ''
                # Remove "dated DD-MM-YY" or "dated DD/MM/YY" trailing text
                import re as _re
                desc = _re.sub(r'\s+dated\s+[\d\-\/]+$', '', desc, flags=_re.IGNORECASE).strip()
                # Remove person name from description to avoid repetition
                if name and name.lower() in desc.lower():
                    desc = _re.sub(_re.escape(name), '', desc, flags=_re.IGNORECASE).strip()
                    desc = _re.sub(r'\s+(to|from)\s*$', '', desc, flags=_re.IGNORECASE).strip()
                d['description'] = desc or 'Payment received'
                clean_recent.append(d)

            result.append({
                'person_name':     name,
                'total_received':  total,
                'last_date':       last_d,
                'txn_count':       len(txns),
                'recent':          clean_recent,
                'net_pending':     net_pending,
                'dues_given_date':   dues_given_date,
                'dues_given_amount': dues_given_amount,
            })

        # Sort by last_date DESC
        result.sort(key=lambda x: x['last_date'], reverse=True)
        return result


def get_person_udhaar_history(store_id: int, person_name: str) -> dict:
    """Full chronological ledger for one person: every given and received event."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM udhaar WHERE store_id = ? AND person_name = ? COLLATE NOCASE",
            (store_id, person_name)
        ).fetchone()
        if not row:
            return {'person_name': person_name, 'balance': 0, 'phone': None, 'transactions': []}

        txns = conn.execute("""
            SELECT ut.date, ut.amount, ut.type, t.description, t.payment_mode, ut.id
            FROM udhaar_transactions ut
            LEFT JOIN transactions t ON ut.transaction_id = t.id
            WHERE ut.udhaar_id = ?
            ORDER BY ut.date ASC, ut.id ASC
        """, (row['id'],)).fetchall()

        # Compute running balance per row (ascending order = correct)
        running = 0.0
        history = []
        for t in txns:
            delta    = t['amount'] if t['type'] == 'given' else -t['amount']
            running += delta
            history.append({
                'date':         t['date'],
                'type':         t['type'],          # 'given' | 'received'
                'amount':       t['amount'],
                'description':  t['description'],
                'payment_mode': t['payment_mode'],
                'running_bal':  round(running, 2),
            })

        return {
            'person_name':  row['person_name'],
            'balance':      row['balance'],
            'phone':        row['phone'],
            'transactions': history,
        }


def get_staff_detail(store_id: int, start: str = None, end: str = None) -> list:
    """Returns each staff person with net total (expenses − receipts) and recent transactions.
    If start/end provided, totals are filtered to that range."""
    today = date.today()
    if not start:
        start = '2000-01-01'
    if not end:
        end = today.isoformat()

    with get_db() as conn:
        staff_names = conn.execute("""
            SELECT DISTINCT person_name FROM transactions
            WHERE store_id = ? AND person_category = 'staff' AND person_name IS NOT NULL
            UNION
            SELECT DISTINCT name FROM persons WHERE store_id = ? AND category = 'staff'
        """, (store_id, store_id)).fetchall()

        result = []
        for row in staff_names:
            name = row[0]
            if not name:
                continue

            # Net total in date range: expenses paid − receipts received
            net_row = conn.execute("""
                SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)
                     - COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE 0 END), 0)
                FROM transactions
                WHERE store_id = ? AND person_name = ? COLLATE NOCASE
                  AND (person_category = 'staff' OR person_category IS NULL)
                  AND type IN ('expense', 'receipt')
                  AND COALESCE(tag, '') IN ('staff_salary', 'staff_expense', 'staff expense', '')
                  AND COALESCE(tag, '') != 'cash_discount'
                  AND date BETWEEN ? AND ?
            """, (store_id, name, start, end)).fetchone()
            net_total = net_row[0] if net_row else 0

            # Recent transactions in range (both expenses and receipts)
            recent = conn.execute("""
                SELECT date, amount, description, payment_mode, type
                FROM transactions
                WHERE store_id = ? AND person_name = ? COLLATE NOCASE
                  AND (person_category = 'staff' OR person_category IS NULL)
                  AND type IN ('expense', 'receipt')
                  AND COALESCE(tag, '') != 'cash_discount'
                  AND date BETWEEN ? AND ?
                ORDER BY date DESC, created_at DESC
                LIMIT 10
            """, (store_id, name, start, end)).fetchall()

            result.append({
                'name':              name,
                'net_total':         net_total,
                'recent_payments':   [dict(r) for r in recent],
            })

        # Sort by absolute net total desc
        result.sort(key=lambda x: abs(x['net_total']), reverse=True)
        return result


def update_udhaar_contact(store_id: int, person_name: str, contact_phone: str):
    """Save/update phone number for a person in udhaar table."""
    with get_db() as conn:
        conn.execute("""
            UPDATE udhaar SET phone = ?
            WHERE store_id = ? AND person_name = ? COLLATE NOCASE
        """, (contact_phone, store_id, person_name))


# ─────────────────────────────────────────────
# Web app message history
# ─────────────────────────────────────────────

def save_web_message(store_id: int, direction: str, body: str = None,
                     media_url: str = None, quick_replies: list = None,
                     metadata: dict = None) -> int:
    """Persist a chat message for the web UI (both user and bot sides)."""
    import json as _json
    qr_json   = _json.dumps(quick_replies or [], ensure_ascii=False)
    meta_json = _json.dumps(metadata, ensure_ascii=False) if metadata is not None else None
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO web_messages (store_id, direction, body, media_url, quick_replies, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (store_id, direction, body, media_url, qr_json, meta_json)
        )
        return cur.lastrowid


def update_message_metadata(msg_id: int, metadata) -> None:
    """Replace metadata for a single web_messages row."""
    import json as _json
    with get_db() as conn:
        conn.execute(
            "UPDATE web_messages SET metadata = ? WHERE id = ?",
            (_json.dumps(metadata) if metadata is not None else None, msg_id)
        )


def delete_transaction(store_id: int, txn_id: int) -> bool:
    """Hard-delete a transaction row (only if it belongs to this store)."""
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM transactions WHERE id = ? AND store_id = ?",
            (txn_id, store_id)
        )
        return result.rowcount > 0


def get_web_messages(store_id: int, after_id: int = 0, limit: int = 80) -> list:
    """
    Return messages for this store newer than after_id.
    after_id = 0 → return last `limit` messages (initial load).
    after_id > 0 → return only messages with id > after_id (polling).
    """
    import json as _json
    with get_db() as conn:
        if after_id == 0:
            rows = conn.execute("""
                SELECT * FROM web_messages
                WHERE store_id = ?
                ORDER BY id DESC LIMIT ?
            """, (store_id, limit)).fetchall()
            rows = list(reversed(rows))
        else:
            rows = conn.execute("""
                SELECT * FROM web_messages
                WHERE store_id = ? AND id > ?
                ORDER BY id ASC LIMIT ?
            """, (store_id, after_id, limit)).fetchall()

    result = []
    for r in rows:
        d = dict(r)
        try:
            d['quick_replies'] = _json.loads(d.get('quick_replies') or '[]')
        except Exception:
            d['quick_replies'] = []
        try:
            raw_meta = d.get('metadata')
            d['metadata'] = _json.loads(raw_meta) if raw_meta else None
        except Exception:
            d['metadata'] = None
        result.append(d)
    return result


def clear_store_data(store_id: int) -> None:
    """Delete all web chat messages AND transactions for a store, and reset bot state."""
    with get_db() as conn:
        conn.execute("DELETE FROM web_messages WHERE store_id = ?", (store_id,))
        # Must delete child tables before parent to satisfy FK constraints
        conn.execute("DELETE FROM udhaar_transactions WHERE udhaar_id IN (SELECT id FROM udhaar WHERE store_id = ?)", (store_id,))
        conn.execute("DELETE FROM udhaar WHERE store_id = ?", (store_id,))
        conn.execute("DELETE FROM transactions WHERE store_id = ?", (store_id,))
        conn.execute("UPDATE stores SET bot_state = '{}' WHERE id = ?", (store_id,))
