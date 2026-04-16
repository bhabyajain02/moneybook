"""
MoneyBook — Database Layer (MongoDB)
=====================================
MongoDB-backed store for retail financial data.

Collections:
  stores              — one doc per WhatsApp number, holds bot conversation state
  transactions        — every financial entry (with tag + confirmation status)
  udhaar              — running credit balance per person
  udhaar_transactions — individual credit/debit events per person
  persons             — person registry: staff / customer / supplier / home
  store_corrections   — correction learning
  web_messages        — web app chat history
  operator_queue      — images waiting for human review
  ai_shadow_parses    — AI parse results
  store_ai_config     — per-store AI config
  operator_users      — admin users
  counters            — auto-increment ID sequences
"""

import os
import re
import json
import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from dotenv import load_dotenv
from pathlib import Path
from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / '.env', override=False)

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'moneybook')

_client = MongoClient(MONGO_URL)
db = _client[DB_NAME]


# ─────────────────────────────────────────────
# Auto-increment ID helper
# ─────────────────────────────────────────────

def _next_id(collection_name: str) -> int:
    """Atomically get next integer ID for a collection."""
    result = db.counters.find_one_and_update(
        {"_id": collection_name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER
    )
    return result["seq"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


def _iregex(name: str) -> dict:
    """Case-insensitive exact match for MongoDB."""
    return {"$regex": f"^{re.escape(name)}$", "$options": "i"}


def _strip_id(doc):
    """Remove MongoDB _id from a document."""
    if doc and '_id' in doc:
        doc = dict(doc)
        del doc['_id']
    return doc


# ─────────────────────────────────────────────
# Schema + Migration
# ─────────────────────────────────────────────

def init_db():
    """Create indexes. Safe to run multiple times (idempotent)."""
    db.stores.create_index("phone", unique=True)
    db.transactions.create_index([("store_id", ASCENDING), ("date", ASCENDING)])
    db.transactions.create_index([("store_id", ASCENDING), ("created_at", ASCENDING)])
    db.udhaar.create_index(
        [("store_id", ASCENDING), ("person_name", ASCENDING)],
        unique=True,
        collation={"locale": "en", "strength": 2}
    )
    db.udhaar_transactions.create_index("udhaar_id")
    db.persons.create_index(
        [("store_id", ASCENDING), ("name", ASCENDING)],
        unique=True,
        collation={"locale": "en", "strength": 2}
    )
    db.store_corrections.create_index("store_id")
    db.web_messages.create_index([("store_id", ASCENDING), ("created_at", ASCENDING)])
    db.operator_queue.create_index([("status", ASCENDING), ("priority", DESCENDING), ("created_at", ASCENDING)])
    db.ai_shadow_parses.create_index("queue_id")
    db.store_ai_config.create_index("store_id", unique=True)
    db.operator_users.create_index("username", unique=True)

    # Seed default admin operator if none exist
    if db.operator_users.count_documents({}) == 0:
        new_id = _next_id("operator_users")
        db.operator_users.insert_one({
            "id": new_id,
            "username": "admin",
            "password_hash": hash_password("admin123"),
            "name": "Admin",
            "role": "admin",
            "active": 1,
            "created_at": _now_iso()
        })

    print(f"✅ Database ready: MongoDB ({DB_NAME})")


def _migrate(conn):
    """No-op for MongoDB — schema is flexible."""
    pass


def _try_alter(conn, sql):
    pass


# ─────────────────────────────────────────────
# Data Migrations
# ─────────────────────────────────────────────

def migrate_fix_negative_udhaar():
    """Fix udhaar records where balance is negative."""
    import logging
    log = logging.getLogger(__name__)
    neg_rows = list(db.udhaar.find({"balance": {"$lt": 0}}))
    for u in neg_rows:
        uid = u['id']
        abs_bal = abs(u['balance'])
        log.info(f"[migration] Fixing udhaar {uid} ({u['person_name']}): {u['balance']} → {abs_bal}")
        db.udhaar.update_one({"id": uid}, {"$set": {"balance": abs_bal}})
        # Flip udhaar_transactions: received↔given
        db.udhaar_transactions.update_many(
            {"udhaar_id": uid, "type": "received"},
            {"$set": {"type": "given_tmp"}}
        )
        db.udhaar_transactions.update_many(
            {"udhaar_id": uid, "type": "given"},
            {"$set": {"type": "received"}}
        )
        db.udhaar_transactions.update_many(
            {"udhaar_id": uid, "type": "given_tmp"},
            {"$set": {"type": "given"}}
        )
        # Flip transaction types
        ut_rows = list(db.udhaar_transactions.find(
            {"udhaar_id": uid, "transaction_id": {"$ne": None}}
        ))
        for row in ut_rows:
            tid = row['transaction_id']
            txn = db.transactions.find_one({"id": tid})
            if txn:
                type_map = {
                    'dues_received': 'dues_given',
                    'dues_given': 'dues_received',
                    'udhaar_received': 'udhaar_given',
                    'udhaar_given': 'udhaar_received',
                }
                new_type = type_map.get(txn['type'], txn['type'])
                if new_type != txn['type']:
                    db.transactions.update_one({"id": tid}, {"$set": {"type": new_type}})


def migrate_clean_dues_given_names():
    """Fix dues_given rows where person_name/description were set to full description text."""
    import logging
    log = logging.getLogger(__name__)

    def _looks_like_sentence(val):
        if not val:
            return False
        words = val.strip().split()
        if len(words) > 3:
            return True
        if re.search(r'\b(dues|given|received|from|dated|amount|paisa|udhaar)\b', val, re.IGNORECASE):
            return True
        return False

    def _extract_person(raw):
        m = re.search(r'\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', raw)
        if m:
            return m.group(1).strip()
        stripped = re.sub(r'^(dues\s+)?(given|received)\s+(to|from)\s+', '', raw, flags=re.IGNORECASE).strip()
        stripped = re.sub(r'\s+dated\s+.*$', '', stripped, flags=re.IGNORECASE).strip()
        if stripped and len(stripped.split()) <= 4:
            return stripped
        return None

    rows = list(db.transactions.find({
        "type": {"$in": ['dues_given', 'udhaar_given', 'dues_received', 'udhaar_received']}
    }))
    for row in rows:
        pname = row.get('person_name') or ''
        desc = row.get('description') or ''
        if not _looks_like_sentence(pname):
            continue
        clean_name = _extract_person(pname) or _extract_person(desc)
        if not clean_name:
            continue
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
        db.transactions.update_one(
            {"id": row['id']},
            {"$set": {"person_name": clean_name, "description": clean_desc}}
        )
        log.info(f"[migration] Fixed txn {row['id']}: person_name='{clean_name}' desc='{clean_desc}'")

    udhaar_rows = list(db.udhaar.find({}))
    for row in udhaar_rows:
        if not _looks_like_sentence(row.get('person_name', '')):
            continue
        clean_name = _extract_person(row['person_name'])
        if clean_name:
            db.udhaar.update_one({"id": row['id']}, {"$set": {"person_name": clean_name}})
            log.info(f"[migration] Fixed udhaar {row['id']}: '{row['person_name']}' → '{clean_name}'")


def migrate_backfill_dues_person_name():
    """Backfill person_name on dues_received/udhaar_received transactions where it is NULL."""
    import logging
    log = logging.getLogger(__name__)
    rows = list(db.transactions.find({
        "type": {"$in": ['dues_received', 'udhaar_received']},
        "$or": [
            {"person_name": None},
            {"person_name": ""}
        ],
        "description": {"$nin": [None, ""]}
    }))
    fixed = 0
    for row in rows:
        desc = row['description']
        m = re.search(r'\bfrom\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', desc)
        if not m:
            stripped = desc.strip()
            if stripped and len(stripped.split()) <= 4 and not any(
                kw in stripped.lower() for kw in ['received', 'paid', 'dues', 'amount', 'rs', '₹']
            ):
                person = stripped
            else:
                continue
        else:
            person = m.group(1).strip()
        db.transactions.update_one({"id": row['id']}, {"$set": {"person_name": person}})
        log.info(f"[migration] Backfilled person_name='{person}' on txn {row['id']}")
        fixed += 1
    if fixed:
        log.info(f"[migration] backfill_dues_person_name: fixed {fixed} rows")


# ─────────────────────────────────────────────
# Store operations
# ─────────────────────────────────────────────

def get_store_by_phone(phone: str):
    """Read-only lookup — returns store dict or None."""
    doc = db.stores.find_one({"phone": phone}, {"_id": 0})
    return doc


def get_or_create_store(phone: str) -> dict:
    doc = db.stores.find_one({"phone": phone}, {"_id": 0})
    if not doc:
        new_id = _next_id("stores")
        doc = {
            "id": new_id,
            "name": None,
            "phone": phone,
            "language": "auto",
            "onboarding_state": "new",
            "bot_state": "{}",
            "segment": "general",
            "created_at": _now_iso()
        }
        db.stores.insert_one(doc)
        doc = db.stores.find_one({"phone": phone}, {"_id": 0})
    return doc


def update_store(store_id: int, **kwargs):
    if not kwargs:
        return
    db.stores.update_one({"id": store_id}, {"$set": kwargs})


def get_all_active_stores() -> list:
    return list(db.stores.find({"onboarding_state": "active"}, {"_id": 0}))


# ─────────────────────────────────────────────
# Bot state (conversation state machine)
# ─────────────────────────────────────────────

def get_bot_state(store_id: int) -> dict:
    doc = db.stores.find_one({"id": store_id}, {"_id": 0, "bot_state": 1})
    try:
        return json.loads(doc.get('bot_state') or '{}') if doc else {}
    except Exception:
        return {}


def set_bot_state(store_id: int, state: dict):
    update_store(store_id, bot_state=json.dumps(state, ensure_ascii=False))


def clear_bot_state(store_id: int):
    update_store(store_id, bot_state='{}')


# ─────────────────────────────────────────────
# Person registry
# ─────────────────────────────────────────────

def get_person(store_id: int, name: str) -> Optional[dict]:
    doc = db.persons.find_one(
        {"store_id": store_id, "name": _iregex(name)},
        {"_id": 0}
    )
    return doc


def save_person(store_id: int, name: str, category: str, notes: str = None):
    """Remember a person's category (upsert) and backfill existing transactions."""
    existing = db.persons.find_one(
        {"store_id": store_id, "name": _iregex(name)}
    )
    if existing:
        db.persons.update_one(
            {"store_id": store_id, "name": _iregex(name)},
            {"$set": {"category": category}}
        )
    else:
        new_id = _next_id("persons")
        db.persons.insert_one({
            "id": new_id,
            "store_id": store_id,
            "name": name,
            "category": category,
            "notes": notes,
            "created_at": _now_iso()
        })
    # Backfill person_category on existing transactions
    db.transactions.update_many(
        {
            "store_id": store_id,
            "person_name": _iregex(name),
            "person_category": None
        },
        {"$set": {"person_category": category}}
    )


def get_unknown_persons(store_id: int, names: list) -> list:
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
    Deduplicates: skips if identical entry was saved within last 10 minutes.
    """
    txn_date = txn.get('date') or date.today().isoformat()

    person_cat = txn.get('person_category')
    if not person_cat and txn.get('person_name'):
        known = get_person(store_id, txn['person_name'])
        if known:
            person_cat = known['category']

    # Deduplication check
    ten_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S')
    recent_dup = db.transactions.find_one({
        "store_id": store_id,
        "date": txn_date,
        "type": txn['type'],
        "amount": float(txn['amount']),
        "created_at": {"$gte": ten_min_ago}
    }, {"_id": 0, "id": 1})
    if recent_dup:
        return recent_dup['id']

    new_id = _next_id("transactions")
    doc = {
        "id": new_id,
        "store_id": store_id,
        "date": txn_date,
        "type": txn['type'],
        "amount": float(txn['amount']),
        "description": txn.get('description'),
        "tag": txn.get('tag'),
        "person_name": txn.get('person_name'),
        "person_category": person_cat,
        "payment_mode": txn.get('payment_mode'),
        "raw_message": raw_message,
        "source": source,
        "created_at": _now_iso()
    }
    db.transactions.insert_one(doc)

    if txn['type'] in ('udhaar_given', 'udhaar_received', 'dues_given', 'dues_received') and txn.get('person_name'):
        _update_udhaar(store_id, txn, new_id, txn_date)

    return new_id


def _update_udhaar(store_id: int, txn: dict, txn_id: int, txn_date: str):
    person = txn['person_name']
    amount = float(txn['amount'])

    row = db.udhaar.find_one(
        {"store_id": store_id, "person_name": _iregex(person)},
        {"_id": 0}
    )
    if not row:
        new_id = _next_id("udhaar")
        db.udhaar.insert_one({
            "id": new_id,
            "store_id": store_id,
            "person_name": person,
            "phone": None,
            "balance": 0,
            "last_transaction_date": txn_date,
            "created_at": _now_iso()
        })
        row = db.udhaar.find_one(
            {"store_id": store_id, "person_name": _iregex(person)},
            {"_id": 0}
        )

    uid = row['id']
    delta = amount if txn['type'] in ('udhaar_given', 'dues_given') else -amount
    ut = 'given' if txn['type'] in ('udhaar_given', 'dues_given') else 'received'

    db.udhaar.update_one(
        {"id": uid},
        {"$inc": {"balance": delta}, "$set": {"last_transaction_date": txn_date}}
    )

    ut_id = _next_id("udhaar_transactions")
    db.udhaar_transactions.insert_one({
        "id": ut_id,
        "udhaar_id": uid,
        "transaction_id": txn_id,
        "amount": amount,
        "type": ut,
        "date": txn_date,
        "notes": None,
        "created_at": _now_iso()
    })


# ─────────────────────────────────────────────
# Summaries & reporting
# ─────────────────────────────────────────────

def get_daily_summary(store_id: int, for_date: str = None) -> dict:
    if not for_date:
        for_date = date.today().isoformat()

    has_data = db.transactions.count_documents({"store_id": store_id, "date": for_date})
    if not has_data:
        latest = db.transactions.find_one(
            {"store_id": store_id},
            sort=[("date", DESCENDING)],
            projection={"_id": 0, "date": 1}
        )
        if latest:
            for_date = latest['date']

    # Totals by type
    pipeline = [
        {"$match": {"store_id": store_id, "date": for_date}},
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]
    agg = list(db.transactions.aggregate(pipeline))

    # Expense tags
    pipeline_tags = [
        {"$match": {"store_id": store_id, "date": for_date, "type": "expense"}},
        {"$addFields": {"resolved_tag": {"$ifNull": [
            {"$cond": [{"$eq": ["$tag", ""]}, "uncategorized", "$tag"]},
            "uncategorized"
        ]}}},
        {"$group": {"_id": "$resolved_tag", "total": {"$sum": "$amount"}}},
        {"$sort": {"total": -1}}
    ]
    expense_tags = list(db.transactions.aggregate(pipeline_tags))

    detail = list(db.transactions.find(
        {"store_id": store_id, "date": for_date},
        {"_id": 0}
    ).sort("created_at", ASCENDING))

    return {
        'date': for_date,
        'summary': {r['_id']: {'total': r['total'], 'count': r['count']} for r in agg},
        'expense_tags': {r['_id']: r['total'] for r in expense_tags},
        'transactions': detail,
    }


def get_period_summary(store_id: int, start_date: str, end_date: str, label: str = '') -> dict:
    match = {"store_id": store_id, "date": {"$gte": start_date, "$lte": end_date}}

    # Totals by type
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}}}
    ]
    agg = list(db.transactions.aggregate(pipeline))

    # Operating expense tags (exclude staff tags)
    staff_tags = ['staff_salary', 'staff_expense', 'staff expense']
    pipeline_tags = [
        {"$match": {**match, "type": "expense", "tag": {"$nin": staff_tags + [None, ""]}}},
        {"$group": {"_id": "$tag", "total": {"$sum": "$amount"}}},
        {"$sort": {"total": -1}}
    ]
    expense_tags_raw = list(db.transactions.aggregate(pipeline_tags))
    # Also get uncategorized expenses (tag is null or empty, not staff)
    uncat_pipeline = [
        {"$match": {**match, "type": "expense", "$or": [{"tag": None}, {"tag": ""}]}},
        {"$group": {"_id": "uncategorized", "total": {"$sum": "$amount"}}}
    ]
    uncat = list(db.transactions.aggregate(uncat_pipeline))
    expense_tags_raw.extend(uncat)

    # Staff expense tags
    pipeline_staff_tags = [
        {"$match": {**match, "type": "expense", "tag": {"$in": staff_tags}}},
        {"$addFields": {"resolved_tag": {"$ifNull": [
            {"$cond": [{"$eq": ["$tag", ""]}, "staff_expense", "$tag"]},
            "staff_expense"
        ]}}},
        {"$group": {"_id": "$resolved_tag", "total": {"$sum": "$amount"}}},
        {"$sort": {"total": -1}}
    ]
    staff_expense_tags = list(db.transactions.aggregate(pipeline_staff_tags))

    # Staff expense total (expenses - receipts with staff tags)
    staff_exp_pipeline = [
        {"$match": {**match, "tag": {"$in": staff_tags}}},
        {"$group": {"_id": None,
                    "expenses": {"$sum": {"$cond": [{"$eq": ["$type", "expense"]}, "$amount", 0]}},
                    "receipts": {"$sum": {"$cond": [{"$eq": ["$type", "receipt"]}, "$amount", 0]}}}}
    ]
    staff_exp_result = list(db.transactions.aggregate(staff_exp_pipeline))
    staff_expense_total = (staff_exp_result[0]['expenses'] - staff_exp_result[0]['receipts']) if staff_exp_result else 0.0

    # Operating expense total
    op_exp_pipeline = [
        {"$match": {**match, "type": "expense", "$or": [
            {"tag": {"$nin": staff_tags}},
            {"tag": None},
            {"tag": ""}
        ]}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]
    op_exp_result = list(db.transactions.aggregate(op_exp_pipeline))
    op_expense_total = op_exp_result[0]['total'] if op_exp_result else 0.0

    # Dues given/received in period
    ug_pipeline = [
        {"$match": {**match, "type": {"$in": ['udhaar_given', 'dues_given']}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]
    ug_result = list(db.transactions.aggregate(ug_pipeline))

    ur_pipeline = [
        {"$match": {**match, "type": {"$in": ['udhaar_received', 'dues_received']}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]
    ur_result = list(db.transactions.aggregate(ur_pipeline))

    # Daily sales trend
    daily_pipeline = [
        {"$match": {**match, "type": "sale"}},
        {"$group": {"_id": "$date", "total": {"$sum": "$amount"}}},
        {"$sort": {"_id": 1}}
    ]
    daily = list(db.transactions.aggregate(daily_pipeline))

    return {
        'label': label,
        'start': start_date,
        'end': end_date,
        'summary': {r['_id']: r['total'] for r in agg},
        'expense_tags': {r['_id']: r['total'] for r in expense_tags_raw},
        'staff_expense_tags': {r['_id']: r['total'] for r in staff_expense_tags},
        'staff_expense': staff_expense_total,
        'operating_expense': op_expense_total,
        'udhaar_given_period': ug_result[0]['total'] if ug_result else 0.0,
        'udhaar_received_period': ur_result[0]['total'] if ur_result else 0.0,
        'daily_sales': [{'date': r['_id'], 'total': r['total']} for r in daily],
    }


def get_weekly_summary(store_id: int) -> dict:
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=6)).isoformat()
    return get_period_summary(store_id, start, end, label='Weekly')


def get_udhaar_outstanding(store_id: int) -> list:
    return list(db.udhaar.find(
        {"store_id": store_id, "balance": {"$gt": 0}},
        {"_id": 0}
    ).sort("balance", DESCENDING))


def get_udhaar_aging(store_id: int, days: int = 30) -> list:
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    return list(db.udhaar.find(
        {"store_id": store_id, "balance": {"$gt": 0}, "last_transaction_date": {"$lte": cutoff}},
        {"_id": 0}
    ).sort("last_transaction_date", ASCENDING))


def get_all_transactions(store_id: int, start: str = None, end: str = None) -> list:
    if not start:
        start = (date.today() - timedelta(days=30)).isoformat()
    if not end:
        end = date.today().isoformat()
    return list(db.transactions.find(
        {"store_id": store_id, "date": {"$gte": start, "$lte": end}},
        {"_id": 0}
    ).sort([("date", DESCENDING), ("created_at", DESCENDING)]))


def get_all_udhaar(store_id: int) -> list:
    return list(db.udhaar.find(
        {"store_id": store_id},
        {"_id": 0}
    ).sort("balance", DESCENDING))


# ─────────────────────────────────────────────
# Correction learning
# ─────────────────────────────────────────────

def get_store_segment(store_id: int) -> str:
    doc = db.stores.find_one({"id": store_id}, {"_id": 0, "segment": 1})
    return (doc.get('segment') or 'general') if doc else 'general'


def save_correction(store_id: int, raw_text: str,
                    original_json: dict, corrected_json: dict,
                    entry_index: int = None,
                    scope: str = 'store',
                    segment: str = None,
                    confidence: int = 1):
    new_id = _next_id("store_corrections")
    db.store_corrections.insert_one({
        "id": new_id,
        "store_id": store_id,
        "raw_text": raw_text,
        "original_json": json.dumps(original_json, ensure_ascii=False),
        "corrected_json": json.dumps(corrected_json, ensure_ascii=False),
        "entry_index": entry_index,
        "scope": scope,
        "segment": segment,
        "confidence": confidence,
        "created_at": _now_iso()
    })


def promote_correction(store_id: int, corrected_json: dict,
                       target_scope: str, target_segment: str = None):
    corr_str = json.dumps(corrected_json, sort_keys=True, ensure_ascii=False)
    rows = list(db.store_corrections.find(
        {"corrected_json": corr_str, "store_id": {"$ne": store_id}},
        {"_id": 0}
    ).sort("confidence", DESCENDING).limit(1))
    if rows:
        db.store_corrections.update_one(
            {"id": rows[0]['id']},
            {"$set": {"scope": target_scope, "segment": target_segment}, "$inc": {"confidence": 1}}
        )


def get_corrections_by_scope(scope: str,
                              store_id: int = None,
                              segment: str = None,
                              limit: int = 10) -> list:
    if scope == 'global':
        rows = list(db.store_corrections.find(
            {"scope": "global"}, {"_id": 0}
        ).sort([("confidence", DESCENDING), ("created_at", DESCENDING)]).limit(limit))
    elif scope == 'segment' and segment and segment != 'general':
        rows = list(db.store_corrections.find(
            {"scope": "segment", "segment": segment}, {"_id": 0}
        ).sort([("confidence", DESCENDING), ("created_at", DESCENDING)]).limit(limit))
    elif scope == 'store' and store_id:
        rows = list(db.store_corrections.find(
            {"scope": "store", "store_id": store_id}, {"_id": 0}
        ).sort("created_at", DESCENDING).limit(limit))
    else:
        rows = []
    return rows


def _format_correction_line(c: dict) -> str:
    try:
        orig = json.loads(c['original_json'])
        corr = json.loads(c['corrected_json'])
        orig_desc = orig.get('description') or orig.get('raw_text') or '?'
        parts = []
        if corr.get('type'):
            parts.append(f"type:{corr['type']}")
        if corr.get('tag'):
            parts.append(f"tag:{corr['tag']}")
        if corr.get('description') and corr['description'] != orig_desc:
            parts.append(f'desc:"{corr["description"]}"')
        if corr.get('person_name'):
            parts.append(f"person:{corr['person_name']}")
        if corr.get('amount'):
            parts.append(f"amount:{corr['amount']}")
        return f'  • "{orig_desc}" → {", ".join(parts)}'
    except Exception:
        return ''


def build_store_context(store_id: int) -> str:
    segment = get_store_segment(store_id)
    global_c = get_corrections_by_scope('global', limit=8)
    segment_c = get_corrections_by_scope('segment', segment=segment, limit=8)
    store_c = get_corrections_by_scope('store', store_id=store_id, limit=15)

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


def get_recent_corrections(store_id: int, limit: int = 15) -> list:
    return get_corrections_by_scope('store', store_id=store_id, limit=limit)


def get_store_expense_tags(store_id: int, limit: int = 15) -> list:
    pipeline = [
        {"$match": {
            "store_id": store_id,
            "type": "expense",
            "tag": {"$nin": [None, "", "staff_salary", "staff_expense", "staff expense"]}
        }},
        {"$group": {"_id": "$tag", "cnt": {"$sum": 1}}},
        {"$sort": {"cnt": -1}},
        {"$limit": limit}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [{'tag': r['_id'], 'count': r['cnt']} for r in rows]


# ─────────────────────────────────────────────
# Analytics helpers
# ─────────────────────────────────────────────

def get_daily_trend(store_id: int, start: str, end: str) -> list:
    pipeline = [
        {"$match": {"store_id": store_id, "date": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": "$date",
            "sales": {"$sum": {"$cond": [{"$eq": ["$type", "sale"]}, "$amount", 0]}},
            "expenses": {"$sum": {"$cond": [{"$eq": ["$type", "expense"]}, "$amount", 0]}}
        }},
        {"$sort": {"_id": 1}}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [{'date': r['_id'], 'sales': r['sales'], 'expenses': r['expenses']} for r in rows]


def get_staff_payments(store_id: int, start: str, end: str) -> list:
    staff_persons = list(db.persons.find(
        {"store_id": store_id, "category": "staff"},
        {"_id": 0, "name": 1}
    ))
    staff_names = [p['name'] for p in staff_persons]
    if not staff_names:
        return []

    staff_tags = ['staff_salary', 'staff_expense', 'staff expense']
    pipeline = [
        {"$match": {
            "store_id": store_id,
            "date": {"$gte": start, "$lte": end},
            "type": {"$in": ["expense", "receipt"]},
            "person_name": {"$ne": None},
            "tag": {"$in": staff_tags}
        }},
        {"$group": {
            "_id": "$person_name",
            "total": {"$sum": {"$cond": [
                {"$eq": ["$type", "expense"]}, "$amount",
                {"$multiply": ["$amount", -1]}
            ]}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"total": -1}}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [{'person_name': r['_id'], 'total': r['total'], 'count': r['count']} for r in rows]


def get_payment_mode_split(store_id: int, start: str, end: str) -> dict:
    pipeline = [
        {"$match": {
            "store_id": store_id,
            "date": {"$gte": start, "$lte": end},
            "type": {"$in": ["sale", "receipt"]}
        }},
        {"$addFields": {"mode": {"$toLower": {"$ifNull": ["$payment_mode", "cash"]}}}},
        {"$group": {"_id": "$mode", "total": {"$sum": "$amount"}}}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    result = {'cash': 0.0, 'upi': 0.0, 'bank': 0.0}
    for r in rows:
        mode = r['_id'] if r['_id'] in ('cash', 'upi', 'bank') else 'cash'
        result[mode] = result.get(mode, 0.0) + (r['total'] or 0.0)
    return result


def get_top_receivers(store_id: int, start: str, end: str, limit: int = 5) -> list:
    pipeline = [
        {"$match": {
            "store_id": store_id,
            "date": {"$gte": start, "$lte": end},
            "type": {"$in": ['udhaar_received', 'dues_received']},
            "person_name": {"$ne": None}
        }},
        {"$group": {
            "_id": "$person_name",
            "total": {"$sum": "$amount"},
            "count": {"$sum": 1}
        }},
        {"$sort": {"total": -1}},
        {"$limit": limit}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [{'person_name': r['_id'], 'total': r['total'], 'count': r['count']} for r in rows]


def get_others_summary(store_id: int, start: str, end: str) -> list:
    pipeline = [
        {"$match": {
            "store_id": store_id,
            "date": {"$gte": start, "$lte": end},
            "person_category": "other",
            "person_name": {"$ne": None}
        }},
        {"$group": {
            "_id": "$person_name",
            "total": {"$sum": "$amount"},
            "count": {"$sum": 1},
            "types": {"$addToSet": "$type"}
        }},
        {"$sort": {"total": -1}}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [{'person_name': r['_id'], 'total': r['total'], 'count': r['count'],
             'types': ','.join(r['types'])} for r in rows]


# ─────────────────────────────────────────────
# Dues & Staff helpers
# ─────────────────────────────────────────────

def get_dues_with_detail(store_id: int) -> list:
    today = date.today()
    udhaar_rows = list(db.udhaar.find(
        {"store_id": store_id, "balance": {"$gt": 0}},
        {"_id": 0}
    ).sort("balance", DESCENDING))

    result = []
    for u in udhaar_rows:
        uid = u['id']
        last_date = u.get('last_transaction_date')
        days_overdue = 0
        if last_date:
            try:
                days_overdue = (today - date.fromisoformat(last_date)).days
            except Exception:
                days_overdue = 0

        # Recent udhaar_transactions with joined transaction detail
        ut_rows = list(db.udhaar_transactions.find(
            {"udhaar_id": uid},
            {"_id": 0}
        ).sort([("date", DESCENDING), ("id", DESCENDING)]).limit(5))

        recent_txns = []
        for ut in ut_rows:
            txn = db.transactions.find_one({"id": ut.get('transaction_id')}, {"_id": 0}) if ut.get('transaction_id') else None
            recent_txns.append({
                'date': ut['date'],
                'amount': ut['amount'],
                'type': ut['type'],
                'description': txn.get('description') if txn else None,
                'payment_mode': txn.get('payment_mode') if txn else None,
            })

        # Totals
        pipeline = [
            {"$match": {"udhaar_id": uid}},
            {"$group": {
                "_id": None,
                "total_given": {"$sum": {"$cond": [{"$eq": ["$type", "given"]}, "$amount", 0]}},
                "total_received": {"$sum": {"$cond": [{"$eq": ["$type", "received"]}, "$amount", 0]}}
            }}
        ]
        totals_result = list(db.udhaar_transactions.aggregate(pipeline))
        total_given = totals_result[0]['total_given'] if totals_result else 0
        total_received = totals_result[0]['total_received'] if totals_result else 0

        result.append({
            'person_name': u['person_name'],
            'phone': u.get('phone'),
            'balance': u['balance'],
            'last_transaction_date': last_date,
            'days_overdue': days_overdue,
            'recent_transactions': recent_txns,
            'total_given': total_given,
            'total_received': total_received,
        })
    return result


def _extract_name_from_desc(desc: str) -> Optional[str]:
    if not desc:
        return None
    m = re.search(r'\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)', desc)
    if m:
        return m.group(1).strip()
    stripped = desc.strip()
    if stripped and len(stripped.split()) <= 4 and not re.search(
        r'received|paid|dues|amount|paisa|mila|rs\.?|₹', stripped, re.IGNORECASE
    ):
        return stripped
    return None


def get_dues_received(store_id: int, start: str = None, end: str = None) -> list:
    query = {
        "store_id": store_id,
        "type": {"$in": ['dues_received', 'udhaar_received']}
    }
    if start and end:
        query["date"] = {"$gte": start, "$lte": end}
    elif start:
        query["date"] = {"$gte": start}
    elif end:
        query["date"] = {"$lte": end}

    all_rows = list(db.transactions.find(query, {"_id": 0}).sort([("date", DESCENDING), ("id", DESCENDING)]))

    from collections import defaultdict
    groups = defaultdict(list)
    for row in all_rows:
        name = row.get('person_name') or _extract_name_from_desc(row.get('description'))
        if not name:
            continue
        groups[name].append(row)

    result = []
    for name, txns in groups.items():
        total = sum(t['amount'] for t in txns)
        last_d = max(t['date'] for t in txns)
        recent = txns[:5]

        udhaar_row = db.udhaar.find_one(
            {"store_id": store_id, "person_name": _iregex(name)},
            {"_id": 0, "balance": 1}
        )
        net_pending = udhaar_row['balance'] if udhaar_row else 0

        given_pipeline = [
            {"$match": {
                "store_id": store_id,
                "type": {"$in": ['dues_given', 'udhaar_given']},
                "person_name": _iregex(name)
            }},
            {"$group": {
                "_id": None,
                "first_given": {"$min": "$date"},
                "total_given": {"$sum": "$amount"}
            }}
        ]
        given_result = list(db.transactions.aggregate(given_pipeline))
        dues_given_date = given_result[0]['first_given'] if given_result else None
        dues_given_amount = given_result[0]['total_given'] if given_result else None

        clean_recent = []
        for txn in recent:
            d = dict(txn)
            desc = d.get('description') or ''
            desc = re.sub(r'\s+dated\s+[\d\-\/]+$', '', desc, flags=re.IGNORECASE).strip()
            if name and name.lower() in desc.lower():
                desc = re.sub(re.escape(name), '', desc, flags=re.IGNORECASE).strip()
                desc = re.sub(r'\s+(to|from)\s*$', '', desc, flags=re.IGNORECASE).strip()
            d['description'] = desc or 'Payment received'
            clean_recent.append(d)

        result.append({
            'person_name': name,
            'total_received': total,
            'last_date': last_d,
            'txn_count': len(txns),
            'recent': clean_recent,
            'net_pending': net_pending,
            'dues_given_date': dues_given_date,
            'dues_given_amount': dues_given_amount,
        })

    result.sort(key=lambda x: x['last_date'], reverse=True)
    return result


def get_person_udhaar_history(store_id: int, person_name: str) -> dict:
    row = db.udhaar.find_one(
        {"store_id": store_id, "person_name": _iregex(person_name)},
        {"_id": 0}
    )
    if not row:
        return {'person_name': person_name, 'balance': 0, 'phone': None, 'transactions': []}

    txns = list(db.udhaar_transactions.find(
        {"udhaar_id": row['id']},
        {"_id": 0}
    ).sort([("date", ASCENDING), ("id", ASCENDING)]))

    running = 0.0
    history = []
    for t in txns:
        txn_detail = db.transactions.find_one({"id": t.get('transaction_id')}, {"_id": 0}) if t.get('transaction_id') else None
        delta = t['amount'] if t['type'] == 'given' else -t['amount']
        running += delta
        history.append({
            'date': t['date'],
            'type': t['type'],
            'amount': t['amount'],
            'description': txn_detail.get('description') if txn_detail else None,
            'payment_mode': txn_detail.get('payment_mode') if txn_detail else None,
            'running_bal': round(running, 2),
        })

    return {
        'person_name': row['person_name'],
        'balance': row['balance'],
        'phone': row.get('phone'),
        'transactions': history,
    }


def update_shadow_parse_accuracy(queue_id: int, accuracy_score: float):
    """Update accuracy_score on an ai_shadow_parses row."""
    db.ai_shadow_parses.update_one(
        {"queue_id": queue_id},
        {"$set": {"accuracy_score": accuracy_score}}
    )


def get_shadow_parse_accuracy(queue_id: int) -> Optional[float]:
    """Get accuracy_score for a shadow parse by queue_id."""
    doc = db.ai_shadow_parses.find_one({"queue_id": queue_id}, {"_id": 0, "accuracy_score": 1})
    return doc.get('accuracy_score') if doc else None



def get_queue_item(queue_id: int) -> Optional[dict]:
    """Get a single operator_queue item by ID."""
    return db.operator_queue.find_one({"id": queue_id}, {"_id": 0})


def delete_operator_transactions(store_id: int, txn_date: str):
    """Delete operator-sourced transactions for a store on a given date."""
    db.transactions.delete_many({"store_id": store_id, "date": txn_date, "source": "operator"})


def get_admin_stats() -> dict:
    """Get dashboard stats for admin."""
    pending = db.operator_queue.count_documents({"status": "pending"})
    in_progress = db.operator_queue.count_documents({"status": "in_progress"})
    today = date.today().isoformat()
    completed_today = db.operator_queue.count_documents({
        "status": "completed",
        "completed_at": {"$regex": f"^{today}"}
    })

    # Average completion time is hard to compute with string timestamps
    # Return None for now — can be computed client-side
    avg_seconds = None

    # Per-store accuracy
    pipeline = [
        {"$lookup": {
            "from": "stores",
            "localField": "store_id",
            "foreignField": "id",
            "as": "store_info"
        }},
        {"$unwind": {"path": "$store_info", "preserveNullAndEmptyArrays": True}},
        {"$project": {
            "_id": 0,
            "store_id": 1,
            "store_name": "$store_info.name",
            "accuracy_score": 1,
            "total_images": 1
        }},
        {"$sort": {"total_images": -1}}
    ]
    store_configs = list(db.store_ai_config.aggregate(pipeline))

    return {
        'pending': pending,
        'in_progress': in_progress,
        'completed_today': completed_today,
        'avg_completion_seconds': avg_seconds,
        'store_configs': store_configs,
    }


def poll_operator_queue(since: str = None) -> dict:
    """Check for new queue items since a timestamp."""
    if since:
        cnt = db.operator_queue.count_documents({"created_at": {"$gt": since}})
    else:
        cnt = db.operator_queue.count_documents({"status": "pending"})
    return {'new_items': cnt, 'since': since}


def get_staff_detail(store_id: int, start: str = None, end: str = None) -> list:
    today = date.today()
    if not start:
        start = '2000-01-01'
    if not end:
        end = today.isoformat()

    # Get all staff names
    staff_from_persons = list(db.persons.find(
        {"store_id": store_id, "category": "staff"},
        {"_id": 0, "name": 1}
    ))
    staff_from_txns = db.transactions.distinct("person_name", {
        "store_id": store_id,
        "$or": [
            {"person_category": "staff"},
            {"type": {"$in": ['staff_payment', 'staff_received']}}
        ],
        "person_name": {"$ne": None}
    })
    all_staff_names = list(set(
        [p['name'] for p in staff_from_persons] + staff_from_txns
    ))

    result = []
    for name in all_staff_names:
        if not name:
            continue
        staff_tags = ['staff_salary', 'staff_expense', 'staff expense']
        txns = list(db.transactions.find({
            "store_id": store_id,
            "person_name": _iregex(name),
            "$or": [
                {"person_category": "staff"},
                {"type": {"$in": ['staff_payment', 'staff_received']}}
            ],
            "type": {"$in": ['expense', 'receipt', 'staff_payment', 'staff_received']},
            "date": {"$gte": start, "$lte": end}
        }, {"_id": 0}).sort([("date", DESCENDING), ("created_at", DESCENDING)]).limit(10))

        net_total = sum(
            t['amount'] if t['type'] in ('expense', 'staff_payment') else -t['amount']
            for t in txns
        )

        recent = [{'date': t['date'], 'amount': t['amount'], 'description': t.get('description'),
                    'payment_mode': t.get('payment_mode'), 'type': t['type']} for t in txns]

        result.append({
            'name': name,
            'net_total': net_total,
            'recent_payments': recent,
        })

    result.sort(key=lambda x: abs(x['net_total']), reverse=True)
    return result


def get_supplier_detail(store_id: int, start: str = None, end: str = None) -> list:
    today = date.today()
    if not start:
        start = '2000-01-01'
    if not end:
        end = today.isoformat()

    pipeline = [
        {"$match": {
            "store_id": store_id,
            "$or": [
                {"person_category": "supplier"},
                {"type": "supplier_payment"}
            ],
            "person_name": {"$nin": [None, ""]},
            "date": {"$gte": start, "$lte": end}
        }},
        {"$group": {
            "_id": "$person_name",
            "total_paid": {"$sum": {"$cond": [
                {"$in": ["$type", ["expense", "dues_given", "supplier_payment"]]},
                {"$cond": [{"$ne": ["$type", "receipt"]}, "$amount", 0]}, 0
            ]}},
            "total_received": {"$sum": {"$cond": [
                {"$in": ["$type", ["receipt", "dues_received", "sale"]]}, "$amount", 0
            ]}},
            "transaction_count": {"$sum": 1},
            "last_date": {"$max": "$date"}
        }},
        {"$sort": {"total_paid": -1}}
    ]
    rows = list(db.transactions.aggregate(pipeline))

    result = []
    for r in rows:
        name = r['_id']
        total_paid = r['total_paid'] or 0
        total_received = r['total_received'] or 0

        recent = list(db.transactions.find({
            "store_id": store_id,
            "person_name": _iregex(name),
            "$or": [{"person_category": "supplier"}, {"type": "supplier_payment"}],
            "date": {"$gte": start, "$lte": end}
        }, {"_id": 0, "date": 1, "amount": 1, "description": 1, "type": 1}
        ).sort([("date", DESCENDING), ("created_at", DESCENDING)]).limit(10))

        result.append({
            'person_name': name,
            'total_paid': total_paid,
            'total_received': total_received,
            'net': total_paid - total_received,
            'transaction_count': r['transaction_count'],
            'last_date': r['last_date'],
            'recent_transactions': recent,
        })

    return result


def get_others_detail(store_id: int, start: str = None, end: str = None) -> list:
    today = date.today()
    if not start:
        start = '2000-01-01'
    if not end:
        end = today.isoformat()

    other_types = ['other', 'opening_balance', 'closing_balance', 'bank_deposit',
                   'receipt', 'upi_in_hand', 'cash_in_hand']
    return list(db.transactions.find(
        {"store_id": store_id, "type": {"$in": other_types},
         "date": {"$gte": start, "$lte": end}},
        {"_id": 0}
    ).sort([("date", DESCENDING), ("created_at", DESCENDING)]))


def get_others_grouped(store_id: int, start: str = None, end: str = None) -> list:
    today = date.today()
    if not start:
        start = '2000-01-01'
    if not end:
        end = today.isoformat()

    other_types = ['other', 'opening_balance', 'closing_balance', 'bank_deposit',
                   'receipt', 'upi_in_hand', 'cash_in_hand']
    rows = list(db.transactions.find(
        {"store_id": store_id, "type": {"$in": other_types},
         "date": {"$gte": start, "$lte": end}},
        {"_id": 0}
    ).sort([("date", DESCENDING), ("created_at", DESCENDING)]))

    TYPE_GROUP_LABELS = {
        'opening_balance': 'Opening Balance',
        'closing_balance': 'Closing Balance',
        'cash_in_hand': 'Cash in Hand',
        'upi_in_hand': 'UPI in Hand',
        'bank_deposit': 'Bank Deposit',
    }

    groups = {}
    for row in rows:
        txn_type = row.get('type', '')
        if txn_type in TYPE_GROUP_LABELS:
            key = txn_type
            label = TYPE_GROUP_LABELS[txn_type]
        else:
            key = (row.get('description') or row.get('tag') or 'Other').strip().lower()
            label = row.get('description') or row.get('tag') or 'Other'
        if key not in groups:
            groups[key] = {'description': label, 'total_amount': 0, 'count': 0, 'entries': []}
        groups[key]['total_amount'] += row.get('amount', 0) or 0
        groups[key]['count'] += 1
        groups[key]['entries'].append({
            'id': row['id'], 'date': row['date'],
            'amount': row['amount'], 'type': row['type'],
        })

    return sorted(groups.values(), key=lambda g: g['total_amount'], reverse=True)


def update_udhaar_contact(store_id: int, person_name: str, contact_phone: str):
    db.udhaar.update_one(
        {"store_id": store_id, "person_name": _iregex(person_name)},
        {"$set": {"phone": contact_phone}}
    )


# ─────────────────────────────────────────────
# Web app message history
# ─────────────────────────────────────────────

def save_web_message(store_id: int, direction: str, body: str = None,
                     media_url: str = None, quick_replies: list = None,
                     metadata: dict = None) -> int:
    qr_json = json.dumps(quick_replies or [], ensure_ascii=False)
    meta_json = json.dumps(metadata, ensure_ascii=False) if metadata is not None else None
    new_id = _next_id("web_messages")
    db.web_messages.insert_one({
        "id": new_id,
        "store_id": store_id,
        "direction": direction,
        "body": body,
        "media_url": media_url,
        "quick_replies": qr_json,
        "metadata": meta_json,
        "created_at": _now_iso()
    })
    return new_id


def update_message_metadata(msg_id: int, metadata) -> None:
    db.web_messages.update_one(
        {"id": msg_id},
        {"$set": {"metadata": json.dumps(metadata) if metadata is not None else None}}
    )


def delete_transaction(store_id: int, txn_id: int) -> bool:
    result = db.transactions.delete_one({"id": txn_id, "store_id": store_id})
    return result.deleted_count > 0


def get_web_messages(store_id: int, after_id: int = 0, limit: int = 80) -> list:
    if after_id == 0:
        rows = list(db.web_messages.find(
            {"store_id": store_id}, {"_id": 0}
        ).sort("id", DESCENDING).limit(limit))
        rows = list(reversed(rows))
    else:
        rows = list(db.web_messages.find(
            {"store_id": store_id, "id": {"$gt": after_id}}, {"_id": 0}
        ).sort("id", ASCENDING).limit(limit))

    result = []
    for r in rows:
        d = dict(r)
        try:
            d['quick_replies'] = json.loads(d.get('quick_replies') or '[]')
        except Exception:
            d['quick_replies'] = []
        try:
            raw_meta = d.get('metadata')
            d['metadata'] = json.loads(raw_meta) if raw_meta else None
        except Exception:
            d['metadata'] = None
        result.append(d)
    return result


def clear_store_data(store_id: int) -> None:
    db.web_messages.delete_many({"store_id": store_id})
    udhaar_ids = [u['id'] for u in db.udhaar.find({"store_id": store_id}, {"id": 1})]
    if udhaar_ids:
        db.udhaar_transactions.delete_many({"udhaar_id": {"$in": udhaar_ids}})
    db.udhaar.delete_many({"store_id": store_id})
    db.transactions.delete_many({"store_id": store_id})
    db.stores.update_one({"id": store_id}, {"$set": {"bot_state": "{}"}})


# ─────────────────────────────────────────────
# Operator Queue & AI Shadow Parse
# ─────────────────────────────────────────────

def add_to_operator_queue(store_id: int, image_path: str, quality_ok: bool = True) -> int:
    new_id = _next_id("operator_queue")
    db.operator_queue.insert_one({
        "id": new_id,
        "store_id": store_id,
        "image_path": image_path,
        "status": "pending",
        "operator_id": None,
        "ai_parse_id": None,
        "quality_ok": 1 if quality_ok else 0,
        "priority": 0,
        "notes": None,
        "created_at": _now_iso(),
        "completed_at": None
    })
    return new_id


def get_operator_queue(status: str = 'pending', limit: int = 50) -> list:
    pipeline = [
        {"$match": {"status": status}},
        {"$sort": {"priority": -1, "created_at": 1}},
        {"$limit": limit},
        {"$lookup": {
            "from": "stores",
            "localField": "store_id",
            "foreignField": "id",
            "as": "store_info"
        }},
        {"$unwind": {"path": "$store_info", "preserveNullAndEmptyArrays": True}},
        {"$addFields": {
            "store_name": "$store_info.name",
            "store_phone": "$store_info.phone"
        }},
        {"$project": {"_id": 0, "store_info": 0}}
    ]
    return list(db.operator_queue.aggregate(pipeline))


def update_queue_status(queue_id: int, status: str, operator_id: str = None,
                        notes: str = None):
    update = {"$set": {"status": status}}
    if operator_id is not None:
        update["$set"]["operator_id"] = operator_id
    if notes is not None:
        update["$set"]["notes"] = notes
    if status == 'completed':
        update["$set"]["completed_at"] = _now_iso()
    db.operator_queue.update_one({"id": queue_id}, update)


def save_shadow_parse(store_id: int, queue_id: int, image_path: str,
                      ai_output: str, model_used: str,
                      prompt_version: str = 'v1') -> int:
    new_id = _next_id("ai_shadow_parses")
    db.ai_shadow_parses.insert_one({
        "id": new_id,
        "store_id": store_id,
        "queue_id": queue_id,
        "image_path": image_path,
        "ai_output": ai_output,
        "operator_output": None,
        "accuracy_score": None,
        "model_used": model_used,
        "prompt_version": prompt_version,
        "created_at": _now_iso()
    })
    db.operator_queue.update_one({"id": queue_id}, {"$set": {"ai_parse_id": new_id}})
    return new_id


def get_shadow_parse_for_queue(queue_id: int) -> Optional[dict]:
    doc = db.ai_shadow_parses.find_one({"queue_id": queue_id}, {"_id": 0})
    if not doc:
        return None
    try:
        doc['ai_output_parsed'] = json.loads(doc['ai_output'])
    except Exception:
        doc['ai_output_parsed'] = None
    return doc


def complete_queue_item(queue_id: int, operator_output: str):
    q = db.operator_queue.find_one({"id": queue_id}, {"_id": 0})
    if not q:
        return
    store_id = q['store_id']
    db.operator_queue.update_one(
        {"id": queue_id},
        {"$set": {"status": "completed", "completed_at": _now_iso()}}
    )
    db.ai_shadow_parses.update_one(
        {"queue_id": queue_id},
        {"$set": {"operator_output": operator_output}}
    )
    # Update store_ai_config totals
    existing = db.store_ai_config.find_one({"store_id": store_id})
    if existing:
        db.store_ai_config.update_one(
            {"store_id": store_id},
            {"$inc": {"total_images": 1}}
        )
    else:
        new_id = _next_id("store_ai_config")
        db.store_ai_config.insert_one({
            "id": new_id,
            "store_id": store_id,
            "ai_mode": "shadow",
            "accuracy_score": 0,
            "total_images": 1,
            "few_shot_ids": "[]",
            "store_vocabulary": "{}",
            "custom_prompt": None,
            "last_eval_at": None
        })


def get_store_ai_config(store_id: int) -> dict:
    doc = db.store_ai_config.find_one({"store_id": store_id}, {"_id": 0})
    if doc:
        return doc
    new_id = _next_id("store_ai_config")
    doc = {
        "id": new_id,
        "store_id": store_id,
        "ai_mode": "shadow",
        "accuracy_score": 0,
        "total_images": 0,
        "few_shot_ids": "[]",
        "store_vocabulary": "{}",
        "custom_prompt": None,
        "last_eval_at": None
    }
    db.store_ai_config.insert_one(doc)
    return db.store_ai_config.find_one({"store_id": store_id}, {"_id": 0})


def update_store_ai_config(store_id: int, **kwargs):
    if not kwargs:
        return
    get_store_ai_config(store_id)  # ensure exists
    db.store_ai_config.update_one({"store_id": store_id}, {"$set": kwargs})


# ─────────────────────────────────────────────
# Operator Users
# ─────────────────────────────────────────────

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def create_operator(username: str, password: str, name: str, role: str = 'operator') -> int:
    new_id = _next_id("operator_users")
    db.operator_users.insert_one({
        "id": new_id,
        "username": username,
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "active": 1,
        "created_at": _now_iso()
    })
    return new_id


def verify_operator(username: str, password: str):
    doc = db.operator_users.find_one(
        {"username": username, "password_hash": hash_password(password), "active": 1},
        {"_id": 0}
    )
    return doc


def get_operator_by_id(operator_id: int):
    doc = db.operator_users.find_one({"id": operator_id}, {"_id": 0})
    return doc


def list_operators():
    return list(db.operator_users.find(
        {"active": 1},
        {"_id": 0, "id": 1, "username": 1, "name": 1, "role": 1, "created_at": 1}
    ))


def get_descriptions_by_type(store_id, txn_type, limit=30):
    pipeline = [
        {"$match": {
            "store_id": store_id, "type": txn_type,
            "description": {"$nin": [None, ""]}
        }},
        {"$group": {
            "_id": {"$toLower": "$description"},
            "description": {"$first": "$description"},
            "cnt": {"$sum": 1}
        }},
        {"$sort": {"cnt": -1}},
        {"$limit": limit}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [r['description'] for r in rows]


def get_tags_by_type(store_id, txn_type, limit=30):
    pipeline = [
        {"$match": {
            "store_id": store_id, "type": txn_type,
            "tag": {"$nin": [None, ""]}
        }},
        {"$group": {
            "_id": {"$toLower": "$tag"},
            "tag": {"$first": "$tag"},
            "cnt": {"$sum": 1}
        }},
        {"$sort": {"cnt": -1}},
        {"$limit": limit}
    ]
    rows = list(db.transactions.aggregate(pipeline))
    return [r['tag'] for r in rows]
