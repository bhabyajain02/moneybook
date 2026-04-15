"""
MoneyBook — AI Accuracy Evaluation & Per-Store Learning
=========================================================
Compares AI shadow parse output vs operator ground truth, scores accuracy,
and feeds learnings back into per-store AI configuration.

Functions:
  compute_accuracy()       — score AI vs operator for a single image
  update_store_learning()  — update store_ai_config with scoring + vocabulary + few-shots
  learn_vocabulary()       — extract abbreviation patterns from operator corrections
  select_few_shot_examples() — manage per-store few-shot example pool
"""

import json
import logging
from datetime import datetime
from difflib import SequenceMatcher
from typing import Optional

log = logging.getLogger('moneybook.eval')


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def fuzzy_ratio(a: str, b: str) -> int:
    """Return 0-100 similarity score between two strings (case-insensitive)."""
    if not a and not b:
        return 100
    if not a or not b:
        return 0
    return int(SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio() * 100)


def _normalise_column(txn: dict) -> str:
    """Derive in/out column from transaction type.
    'in' = money coming into the store, 'out' = money going out."""
    t = (txn.get('type') or txn.get('column') or '').lower()
    IN_TYPES = {
        'sale', 'receipt', 'opening_balance', 'dues_received',
        'upi_in_hand', 'cash_in_hand',
    }
    OUT_TYPES = {
        'expense', 'dues_given', 'bank_deposit', 'closing_balance',
    }
    if t in IN_TYPES:
        return 'in'
    if t in OUT_TYPES:
        return 'out'
    # Check explicit column field
    col = (txn.get('column') or '').lower()
    if col in ('in', 'out'):
        return col
    return 'unknown'


def _safe_float(val) -> float:
    """Convert amount to float, handling None/str gracefully."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


# ─────────────────────────────────────────────
# Core: compute_accuracy
# ─────────────────────────────────────────────

def compute_accuracy(ai_txns: list, operator_txns: list) -> dict:
    """
    Compare AI shadow parse output vs operator ground truth.

    Args:
        ai_txns: list of dicts from AI parse (description, amount, type, person_name, column)
        operator_txns: list of dicts from operator entry (same schema)

    Returns:
        dict with overall_score, row_count_match, matched_rows,
        missed_by_ai, hallucinated, field_breakdown
    """
    if not operator_txns:
        # Nothing to score against
        return {
            'overall_score': 100.0 if not ai_txns else 0.0,
            'row_count_match': len(ai_txns) == 0,
            'matched_rows': [],
            'missed_by_ai': [],
            'hallucinated': [{'ai_index': i, 'row': t} for i, t in enumerate(ai_txns)],
            'field_breakdown': {
                'amount_accuracy': 0, 'type_accuracy': 0,
                'description_accuracy': 0, 'person_accuracy': 0,
            },
        }

    if not ai_txns:
        return {
            'overall_score': 0.0,
            'row_count_match': False,
            'matched_rows': [],
            'missed_by_ai': [{'op_index': i, 'row': t} for i, t in enumerate(operator_txns)],
            'hallucinated': [],
            'field_breakdown': {
                'amount_accuracy': 0, 'type_accuracy': 0,
                'description_accuracy': 0, 'person_accuracy': 0,
            },
        }

    # Step 1: Build candidate match scores
    # For each (op_idx, ai_idx) pair, compute a match quality score
    candidates = []
    for oi, op_row in enumerate(operator_txns):
        op_amt = _safe_float(op_row.get('amount'))
        op_col = _normalise_column(op_row)

        for ai_idx, ai_row in enumerate(ai_txns):
            ai_amt = _safe_float(ai_row.get('amount'))
            ai_col = _normalise_column(ai_row)

            # Must be same column direction (or unknown) AND amount within 10%
            col_match = (op_col == ai_col) or op_col == 'unknown' or ai_col == 'unknown'
            if op_amt > 0:
                amt_diff = abs(ai_amt - op_amt) / op_amt
            else:
                amt_diff = 0.0 if ai_amt == 0 else 1.0

            if not col_match or amt_diff > 0.10:
                continue  # Not a viable match

            # Rank by description similarity
            desc_score = fuzzy_ratio(
                ai_row.get('description', ''),
                op_row.get('description', '')
            )
            # Composite match quality (amount closeness + description similarity)
            quality = (1.0 - amt_diff) * 50 + desc_score * 0.5
            candidates.append((quality, oi, ai_idx))

    # Step 2: Greedy matching — best scores first, no double-counting
    candidates.sort(key=lambda x: -x[0])
    used_op = set()
    used_ai = set()
    matched_rows = []

    for quality, oi, ai_idx in candidates:
        if oi in used_op or ai_idx in used_ai:
            continue
        used_op.add(oi)
        used_ai.add(ai_idx)

        op_row = operator_txns[oi]
        ai_row = ai_txns[ai_idx]

        # Step 3: Score each matched pair
        field_scores = _score_pair(ai_row, op_row)
        matched_rows.append({
            'ai_index': ai_idx,
            'op_index': oi,
            'ai_row': ai_row,
            'op_row': op_row,
            'field_scores': field_scores,
        })

    # Unmatched rows
    missed_by_ai = [
        {'op_index': i, 'row': operator_txns[i]}
        for i in range(len(operator_txns)) if i not in used_op
    ]
    hallucinated = [
        {'ai_index': i, 'row': ai_txns[i]}
        for i in range(len(ai_txns)) if i not in used_ai
    ]

    # Step 4: Overall score
    if matched_rows:
        # Weighted average of matched rows
        row_scores = []
        for m in matched_rows:
            fs = m['field_scores']
            weighted = (
                fs['amount'] * 0.40 +
                fs['type'] * 0.25 +
                fs['description'] * 0.25 +
                fs['person'] * 0.10
            )
            row_scores.append(weighted)
        avg_score = sum(row_scores) / len(row_scores)
    else:
        avg_score = 0.0

    # Penalties
    penalty = len(missed_by_ai) * 15 + len(hallucinated) * 10
    overall = max(0.0, min(100.0, avg_score - penalty))

    # Field breakdown (average across matched pairs)
    n_matched = len(matched_rows) or 1
    field_breakdown = {
        'amount_accuracy': sum(m['field_scores']['amount'] for m in matched_rows) / n_matched,
        'type_accuracy': sum(m['field_scores']['type'] for m in matched_rows) / n_matched,
        'description_accuracy': sum(m['field_scores']['description'] for m in matched_rows) / n_matched,
        'person_accuracy': sum(m['field_scores']['person'] for m in matched_rows) / n_matched,
    }

    return {
        'overall_score': round(overall, 2),
        'row_count_match': len(ai_txns) == len(operator_txns),
        'matched_rows': matched_rows,
        'missed_by_ai': missed_by_ai,
        'hallucinated': hallucinated,
        'field_breakdown': {k: round(v, 2) for k, v in field_breakdown.items()},
    }


def _score_pair(ai_row: dict, op_row: dict) -> dict:
    """Score a single matched pair across all fields. Returns dict of 0-100 scores."""
    # Amount
    ai_amt = _safe_float(ai_row.get('amount'))
    op_amt = _safe_float(op_row.get('amount'))
    if op_amt == 0 and ai_amt == 0:
        amt_score = 100
    elif op_amt == 0:
        amt_score = 0
    else:
        diff_pct = abs(ai_amt - op_amt) / op_amt
        if diff_pct == 0:
            amt_score = 100
        elif diff_pct <= 0.05:
            amt_score = 90
        elif diff_pct <= 0.10:
            amt_score = 70
        else:
            amt_score = 0

    # Type
    ai_type = (ai_row.get('type') or '').lower().strip()
    op_type = (op_row.get('type') or '').lower().strip()
    type_score = 100 if ai_type == op_type else 0

    # Description
    desc_score = fuzzy_ratio(
        ai_row.get('description', ''),
        op_row.get('description', '')
    )

    # Person
    ai_person = (ai_row.get('person_name') or '').strip()
    op_person = (op_row.get('person_name') or '').strip()
    if not ai_person and not op_person:
        person_score = 100  # Both empty — correct
    elif not ai_person or not op_person:
        person_score = 0  # One has a name, other doesn't
    else:
        p_ratio = fuzzy_ratio(ai_person, op_person)
        if ai_person.lower() == op_person.lower():
            person_score = 100
        elif p_ratio > 80:
            person_score = 80
        else:
            person_score = 0

    return {
        'amount': amt_score,
        'type': type_score,
        'description': desc_score,
        'person': person_score,
    }


# ─────────────────────────────────────────────
# Vocabulary Learning
# ─────────────────────────────────────────────

def learn_vocabulary(ai_txns: list, operator_txns: list, matched_pairs: list) -> dict:
    """
    Extract correction patterns from operator changes.
    Returns dict of vocabulary items including:
    - Abbreviation expansions: {"CD": "Cash Discount"}
    - Type corrections: {"type:Opening Balance": "opening_balance"}
    - Description → type mappings: {"desc_type:Sale": "sale"}
    """
    new_vocab = {}

    for match in matched_pairs:
        ai_row = match.get('ai_row', {})
        op_row = match.get('op_row', {})
        ai_desc = (ai_row.get('description') or '').strip()
        op_desc = (op_row.get('description') or '').strip()
        ai_type = (ai_row.get('type') or '').strip()
        op_type = (op_row.get('type') or '').strip()

        # Strategy 1: Learn TYPE corrections
        # If AI assigned wrong type, learn "this description → this type"
        if ai_type and op_type and ai_type != op_type and op_desc:
            # Use the operator's description as the key for type mapping
            desc_key = op_desc.lower().strip()
            if len(desc_key) > 2:
                new_vocab[f"type:{desc_key}"] = op_type
                log.info(f"  Learned type correction: '{desc_key}' should be type '{op_type}' (AI said '{ai_type}')")

        if not ai_desc or not op_desc:
            continue

        similarity = fuzzy_ratio(ai_desc, op_desc)
        # Only learn abbreviations from significantly different descriptions
        if similarity > 80:
            continue

        # Strategy 2: AI has a short abbreviation, operator expanded it
        ai_words = ai_desc.split()
        op_words = op_desc.split()

        for ai_word in ai_words:
            ai_w_upper = ai_word.upper()
            if len(ai_w_upper) > 5 or ai_w_upper.isdigit():
                continue
            if ai_w_upper in ('THE', 'AND', 'FOR', 'FROM', 'TO', 'OF', 'IN', 'ON', 'AT'):
                continue
            if len(ai_w_upper) >= 2 and ai_w_upper == ai_w_upper.upper():
                _try_abbreviation_match(ai_w_upper, op_words, new_vocab)

        # Strategy 3: Description completely wrong
        if similarity < 40 and len(ai_desc) < 30 and len(op_desc) < 60:
            if len(ai_desc.split()) <= 3 and len(ai_desc) < 15:
                new_vocab[ai_desc] = op_desc

    return new_vocab


def _try_abbreviation_match(abbrev: str, expanded_words: list, vocab: dict):
    """Try to match an abbreviation to consecutive words in the expanded text.
    e.g. "CD" matches "Cash Discount", "BD" matches "Bank Deposit"."""
    letters = list(abbrev.upper())
    n = len(letters)

    for start in range(len(expanded_words)):
        if start + n > len(expanded_words):
            break
        candidate_words = expanded_words[start:start + n]
        # Check if first letter of each word matches abbreviation letters
        if all(
            w[0].upper() == letters[i]
            for i, w in enumerate(candidate_words)
            if w  # skip empty strings
        ):
            expansion = ' '.join(candidate_words)
            if expansion.lower() != abbrev.lower():  # Don't map to itself
                vocab[abbrev] = expansion
                return


# ─────────────────────────────────────────────
# Few-Shot Example Selection
# ─────────────────────────────────────────────

def select_few_shot_examples(store_id: int, new_queue_id: int, new_accuracy: float,
                             operator_txns: list = None,
                             current_few_shot_ids: list = None,
                             current_few_shot_scores: dict = None) -> list:
    """
    Decide if this image should be a few-shot example for this store.

    Criteria:
    - Accuracy > 85% (good quality image that AI mostly got right)
    - Has diverse transaction types (at least 3 different types)
    - Keep max 5 few-shot examples per store
    - Replace the oldest/lowest-accuracy one if at capacity

    Returns updated few_shot_ids list.
    """
    MAX_FEW_SHOTS = 5

    if current_few_shot_ids is None:
        current_few_shot_ids = []
    if current_few_shot_scores is None:
        current_few_shot_scores = {}

    # Don't add if already present
    if new_queue_id in current_few_shot_ids:
        return current_few_shot_ids

    # Check minimum accuracy threshold — start low so we learn from early images
    if new_accuracy < 30:
        return current_few_shot_ids

    # Check diversity: need at least 2 different transaction types
    if operator_txns:
        types_seen = set(
            (t.get('type') or 'other').lower() for t in operator_txns
        )
        if len(types_seen) < 2:
            return current_few_shot_ids

    # Add to pool
    if len(current_few_shot_ids) < MAX_FEW_SHOTS:
        current_few_shot_ids.append(new_queue_id)
    else:
        # Replace lowest-accuracy example
        worst_id = None
        worst_score = new_accuracy
        for fid in current_few_shot_ids:
            score = current_few_shot_scores.get(str(fid), current_few_shot_scores.get(fid, 100))
            if score < worst_score:
                worst_score = score
                worst_id = fid

        if worst_id is not None:
            idx = current_few_shot_ids.index(worst_id)
            current_few_shot_ids[idx] = new_queue_id
        # else: new example isn't better than any existing one — skip

    return current_few_shot_ids


# ─────────────────────────────────────────────
# Store Learning Update (main orchestrator)
# ─────────────────────────────────────────────

def update_store_learning(store_id: int, queue_id: int,
                          ai_output: list, operator_output: list,
                          accuracy_score: float):
    """
    After scoring, update per-store AI learning data.

    1. Update store_ai_config.accuracy_score (rolling avg of last 20)
    2. Update store_ai_config.total_images (already done by complete_queue_item)
    3. Learn vocabulary from operator corrections
    4. Select few-shot examples
    5. Check mode transition thresholds
    """
    from moneybook_db import get_store_ai_config, update_store_ai_config, get_db

    config = get_store_ai_config(store_id)

    # 1. Rolling average accuracy (last 20 images)
    #    Formula: new_avg = old_avg * (n-1)/n + new_score/n  where n = min(total, 20)
    total_images = config.get('total_images', 1)
    window = min(total_images, 20)
    old_avg = config.get('accuracy_score', 0) or 0
    if window <= 1:
        new_avg = accuracy_score
    else:
        new_avg = old_avg * (window - 1) / window + accuracy_score / window
    new_avg = round(new_avg, 2)

    # 2. Save accuracy_score to the shadow parse row
    with get_db() as conn:
        conn.execute(
            "UPDATE ai_shadow_parses SET accuracy_score = ? WHERE queue_id = ?",
            (accuracy_score, queue_id)
        )

    # 3. Learn vocabulary from operator corrections
    result = compute_accuracy(ai_output, operator_output)
    matched_pairs = result.get('matched_rows', [])
    new_vocab = learn_vocabulary(ai_output, operator_output, matched_pairs)

    # Merge with existing vocabulary
    existing_vocab = {}
    try:
        existing_vocab = json.loads(config.get('store_vocabulary') or '{}')
    except (json.JSONDecodeError, TypeError):
        pass
    if new_vocab:
        existing_vocab.update(new_vocab)
        log.info(f"Store {store_id}: learned {len(new_vocab)} new vocabulary items: {new_vocab}")

    # 4. Select few-shot examples
    current_ids = []
    try:
        current_ids = json.loads(config.get('few_shot_ids') or '[]')
    except (json.JSONDecodeError, TypeError):
        pass

    # Build scores dict for existing few-shots
    few_shot_scores = {}
    with get_db() as conn:
        for fid in current_ids:
            row = conn.execute(
                "SELECT accuracy_score FROM ai_shadow_parses WHERE queue_id = ?",
                (fid,)
            ).fetchone()
            if row and row['accuracy_score'] is not None:
                few_shot_scores[fid] = row['accuracy_score']

    updated_ids = select_few_shot_examples(
        store_id=store_id,
        new_queue_id=queue_id,
        new_accuracy=accuracy_score,
        operator_txns=operator_output,
        current_few_shot_ids=current_ids,
        current_few_shot_scores=few_shot_scores,
    )

    # 5. Check mode transition
    ai_mode = config.get('ai_mode', 'shadow')
    if new_avg > 95 and total_images > 100:
        ai_mode = 'autonomous'
    elif new_avg > 90 and total_images > 30:
        ai_mode = 'assisted'
    # else: stay in current mode (shadow)

    # Persist all updates
    update_store_ai_config(
        store_id,
        accuracy_score=new_avg,
        store_vocabulary=json.dumps(existing_vocab, ensure_ascii=False),
        few_shot_ids=json.dumps(updated_ids),
        ai_mode=ai_mode,
        last_eval_at=datetime.utcnow().isoformat(),
    )

    log.info(
        f"Store {store_id} learning update: accuracy={new_avg:.1f}%, "
        f"mode={ai_mode}, vocab_size={len(existing_vocab)}, "
        f"few_shots={len(updated_ids)}"
    )

    return {
        'accuracy_score': new_avg,
        'ai_mode': ai_mode,
        'new_vocabulary': new_vocab,
        'few_shot_ids': updated_ids,
    }
