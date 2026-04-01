import { useState } from "react";
import { quickParse } from "../api.js";
import { t } from "../translations.js";

// Extract clean person name from a value that might be a full sentence
// e.g. "Dues received from Sanjiv Mishra" → "Sanjiv Mishra"
function extractDisplayName(name) {
  if (!name) return "";
  const m = name.match(/\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/i);
  if (m) return m[1].trim();
  return name;
}

export const TYPE_OPTIONS = [
  { value: "sale", label: "💰 Sale" },
  { value: "expense", label: "💸 Expense" },
  { value: "dues_given", label: "📤 Dues Given" },
  { value: "dues_received", label: "📥 Dues Received" },
  { value: "bank_deposit", label: "🏦 Bank Deposit" },
  { value: "receipt", label: "📨 Receipt" },
  { value: "opening_balance", label: "🔓 Opening Bal" },
  { value: "closing_balance", label: "🔒 Closing Bal" },
  { value: "cash_in_hand", label: "💵 Cash in Hand" },
  { value: "upi_in_hand", label: "📱 UPI in Hand" },
  { value: "other", label: "📋 Other" },
];

export function getTypeOptions(language) {
  return TYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.key, language),
  }));
}

export const TYPE_COLORS = {
  sale: "#25D366",
  receipt: "#25D366",
  dues_given: "#E53935",
  dues_received: "#25D366",
  expense: "#FF7043",
  bank_deposit: "#9C27B0",
  other: "#78909C",
  opening_balance: "#607D8B",
  closing_balance: "#607D8B",
  cash_in_hand: "#607D8B",
  upi_in_hand: "#2196F3",
};
const MODE_ICONS = { cash: "💵", upi: "📱", bank: "🏦", credit: "📒" };

export function fmtRs(val) {
  const n = parseFloat(val) || 0;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// ── Inline edit form (shared by both table and card layout) ──────
export function EditForm({ txn, onSave, onDiscard, language }) {
  const [draft, setDraft] = useState({ ...txn });
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  async function save() {
    const descChanged =
      (draft.description || "").trim() !== (txn.description || "").trim();
    if (descChanged && !more) {
      setSaving(true);
      try {
        const res = await quickParse(
          draft.description,
          draft.amount,
          draft.person_name || "",
        );
        onSave({
          ...draft,
          type: res.transaction.type,
          tag: res.transaction.tag,
        });
      } catch {
        onSave(draft);
      } finally {
        setSaving(false);
      }
    } else {
      onSave(draft);
    }
  }

  return (
    <div className="inline-edit-form">
      <div className="txn-edit-grid">
        <label>{t("description_label", language)}</label>
        <input
          type="text"
          value={draft.description || ""}
          placeholder="What was this?"
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <label>{t("amount_label", language)}</label>
        <input
          type="number"
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) =>
            setDraft({ ...draft, amount: parseFloat(e.target.value) || 0 })
          }
        />
        <label>{t("person_label", language)}</label>
        <input
          type="text"
          value={draft.person_name || ""}
          placeholder="Name (optional)"
          onChange={(e) =>
            setDraft({ ...draft, person_name: e.target.value || null })
          }
        />
      </div>
      <button className="txn-more-toggle" onClick={() => setMore((s) => !s)}>
        {more ? "▲ Less" : "▼ Change Type"}
      </button>
      {more && (
        <div className="txn-edit-grid" style={{ marginTop: 6 }}>
          <label>Type</label>
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            {getTypeOptions(language).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="txn-edit-actions">
        <button className="txn-save-btn" onClick={save} disabled={saving}>
          {saving ? "⏳" : t("done_btn", language)}
        </button>
        <button className="txn-cancel-btn" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

// ── Confidence pill ──────────────────────────────────────────────
export function ConfPill({ value }) {
  if (value == null) return null;
  const v = Math.round(value);
  const bg = v >= 80 ? "#dcfce7" : v >= 70 ? "#fef3c7" : "#fee2e2";
  const fg = v >= 80 ? "#166534" : v >= 70 ? "#92400e" : "#991b1b";
  return (
    <span
      className="txn-conf"
      style={{ background: bg, color: fg }}
      title={`Confidence: ${v}/100`}
    >
      {v}
    </span>
  );
}

// ── TRANSACTION TABLE — one row per parsed transaction, always ───
// Iterates txns[] directly so every entry always gets ✏️ and 🗑️.
// display.headers used for column context when available.
function TransactionTable({ txns, onUpdate, onDelete, language }) {
  const [editingIdx, setEditingIdx] = useState(null);

  return (
    <div className="notebook-table-wrap">
      <table className="notebook-table">
        <thead>
          <tr>
            <th>{t("description_label", language)}</th>
            <th className="nb-th-num">{t("amount_label", language)}</th>
            <th className="nb-actions-col nb-actions-sticky"></th>
          </tr>
        </thead>
        <tbody>
          {txns.map((txn, i) => {
            if (!txn) return null; // deleted entry

            if (editingIdx === i) {
              return (
                <tr key={i} className="nb-row-editing">
                  <td colSpan={3}>
                    <EditForm
                      txn={txn}
                      onSave={(u) => {
                        onUpdate(i, u);
                        setEditingIdx(null);
                      }}
                      onDiscard={() => setEditingIdx(null)}
                      language={language}
                    />
                  </td>
                </tr>
              );
            }

            const color = TYPE_COLORS[txn.type] || "#ccc";
            const typeLabel =
              getTypeOptions(language).find((o) => o.value === txn.type)
                ?.label || txn.type;

            return (
              <tr
                key={i}
                className="nb-row-data"
                style={{ borderLeftColor: color }}
              >
                <td className="nb-cell">
                  <span
                    className="nb-type-pill"
                    style={{ background: color + "1a", color }}
                  >
                    {typeLabel}
                  </span>
                  <span className="nb-txn-desc">{txn.description || "—"}</span>
                  {txn.tag && (
                    <span className="nb-txn-tag">
                      🏷️ {txn.tag.replace(/_/g, " ")}
                    </span>
                  )}
                  {txn.person_name && (
                    <span className="nb-txn-person">
                      {" "}
                      · {extractDisplayName(txn.person_name)}
                    </span>
                  )}
                </td>
                <td className="nb-cell nb-cell-num">
                  ₹
                  {parseFloat(txn.amount).toLocaleString("en-IN", {
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="nb-actions-col nb-actions-sticky">
                  <ConfPill value={txn.confidence} />
                  <button
                    className="nb-btn"
                    onClick={() => setEditingIdx(i)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    className="nb-btn"
                    onClick={() => onDelete(i)}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── CARD LIST — fallback for text messages ───────────────────────
function TxnCard({ txn, index, onChange, onDelete, language }) {
  const [editing, setEditing] = useState(false);
  const color = TYPE_COLORS[txn.type] || "#666";
  const typeLabel =
    getTypeOptions(language).find((o) => o.value === txn.type)?.label ||
    txn.type;
  const modeIcon = MODE_ICONS[txn.payment_mode] || "💵";

  if (!editing) {
    return (
      <div className="txn-card" style={{ borderLeftColor: color }}>
        <div className="txn-card-row">
          <span className="txn-num" style={{ background: color }}>
            #{index + 1}
          </span>
          <span
            className="txn-type-badge"
            style={{ background: color + "18", color }}
          >
            {typeLabel}
          </span>
          <span className="txn-amount">
            ₹{parseFloat(txn.amount).toLocaleString("en-IN")}
          </span>
          <ConfPill value={txn.confidence} />
          <button
            className="txn-edit-btn"
            onClick={() => setEditing(true)}
            title="Edit"
          >
            ✏️
          </button>
          <button className="txn-delete-btn" onClick={onDelete} title="Delete">
            🗑️
          </button>
        </div>
        <div className="txn-desc">{txn.description || "—"}</div>
        <div className="txn-footer-row">
          {txn.person_name && (
            <span className="txn-person">
              👤 {extractDisplayName(txn.person_name)}
            </span>
          )}
          {txn.tag && txn.type === "expense" && (
            <span className="txn-tag">🏷️ {txn.tag.replace(/_/g, " ")}</span>
          )}
          <span className="txn-mode">
            {modeIcon} {txn.payment_mode || "cash"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="txn-card editing" style={{ borderLeftColor: color }}>
      <div className="txn-edit-header">✏️ Edit entry #{index + 1}</div>
      <EditForm
        txn={txn}
        onSave={(u) => {
          onChange(index, u);
          setEditing(false);
        }}
        onDiscard={() => setEditing(false)}
        language={language}
      />
    </div>
  );
}

// ── Add entry form ───────────────────────────────────────────────
export function AddEntryForm({ onAdd, onCancel, language }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [person, setPerson] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!desc.trim() || !amount) return;
    setLoading(true);
    try {
      const res = await quickParse(desc, parseFloat(amount), person);
      onAdd(res.transaction);
    } catch {
      onAdd({
        type: "expense",
        amount: parseFloat(amount),
        description: desc,
        tag: "other",
        person_name: person || null,
        needs_tracking: !!person,
        payment_mode: "cash",
        date: new Date().toISOString().slice(0, 10),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="add-entry-form">
      <div className="add-entry-title">{t("new_entry", language)}</div>
      <form onSubmit={handleSubmit}>
        <input
          className="add-entry-input"
          type="text"
          placeholder="Description (e.g. Rent paid)"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          required
        />
        <input
          className="add-entry-input"
          type="number"
          inputMode="decimal"
          placeholder="Amount ₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <input
          className="add-entry-input"
          type="text"
          placeholder="Person (optional)"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <div className="add-entry-actions">
          <button type="submit" className="txn-save-btn" disabled={loading}>
            {loading ? "..." : "➕ Add"}
          </button>
          <button type="button" className="txn-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main ConfirmCard ─────────────────────────────────────────────
export default function ConfirmCard({
  metadata,
  onConfirm,
  onCancel,
  onPendingEdit,
  language,
}) {
  const rawTxns = metadata.pending_transactions || [];
  const initDate =
    metadata.page_date ||
    rawTxns[0]?.date ||
    new Date().toISOString().slice(0, 10);

  const [txns, setTxns] = useState(rawTxns);
  const [batchDate, setBatchDate] = useState(initDate);
  const [adding, setAdding] = useState(false);

  // Sync edits back to ChatWindow so tab navigation doesn't lose them
  function syncUp(newTxns) {
    onPendingEdit?.(newTxns.filter(Boolean));
  }

  function handleBatchDate(newDate) {
    if (!newDate) return;
    setBatchDate(newDate);
    setTxns((prev) => {
      const next = prev.map((t) => (t ? { ...t, date: newDate } : t));
      syncUp(next);
      return next;
    });
  }

  function handleUpdate(idx, updated) {
    setTxns((prev) => {
      const next = prev.map((t, i) => (i === idx ? updated : t));
      syncUp(next);
      return next;
    });
  }

  function handleDelete(idx) {
    setTxns((prev) => {
      const next = prev.map((t, i) => (i === idx ? null : t));
      syncUp(next);
      return next;
    });
  }

  const liveTxns = txns.filter(Boolean);

  const totalIn = liveTxns
    .filter(
      (t) =>
        ["sale", "receipt", "dues_received", "udhaar_received"].includes(
          t.type,
        ) ||
        (t.type === "other" && t.column === "in"),
    )
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const totalOut = liveTxns
    .filter(
      (t) =>
        ["expense", "dues_given", "udhaar_given", "bank_deposit"].includes(
          t.type,
        ) ||
        (t.type === "other" && t.column !== "in"),
    )
    .reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);

  return (
    <div className="confirm-card-wrapper">
      {/* Date row */}
      <div className="confirm-date-row">
        <span className="confirm-date-label">📅</span>
        <input
          type="date"
          className="confirm-date-inline"
          value={batchDate}
          onChange={(e) => handleBatchDate(e.target.value)}
        />
      </div>

      {/* Summary totals */}
      {(totalIn > 0 || totalOut > 0) && (
        <div className="confirm-summary-bar">
          <span>
            📥 In: <b style={{ color: "#25D366" }}>{fmtRs(totalIn)}</b>
          </span>
          <span>
            📤 Out: <b style={{ color: "#E53935" }}>{fmtRs(totalOut)}</b>
          </span>
        </div>
      )}

      {/* Every entry as a row with ✏️ and 🗑️ */}
      <TransactionTable
        txns={txns}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        language={language}
      />

      {/* Add missed entry */}
      {adding ? (
        <AddEntryForm
          onAdd={(txn) => {
            setTxns((prev) => [...prev, txn]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
          language={language}
        />
      ) : (
        <button className="add-entry-btn" onClick={() => setAdding(true)}>
          {t("add_entry", language)}
        </button>
      )}

      <div className="confirm-card-actions">
        <button
          className="confirm-save-btn"
          onClick={() => onConfirm(liveTxns)}
        >
          {t("save_all", language)} ({liveTxns.length})
        </button>
        <button className="confirm-cancel-btn" onClick={onCancel}>
          ❌
        </button>
      </div>
    </div>
  );
}
