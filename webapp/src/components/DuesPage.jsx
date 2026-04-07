import { useState, useEffect } from "react";
import {
  fetchDues,
  fetchStaff,
  updateDuesContact,
  fetchPersonDuesHistory,
} from "../api.js";
import { t } from "../translations.js";

function fmtRs(val) {
  const n = parseFloat(val) || 0;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function daysColor(days) {
  if (days > 60) return "#D32F2F";
  if (days > 30) return "#E64A19";
  return "#F57C00";
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}
function getRange(period) {
  const today = new Date();
  if (period === "month")
    return {
      start: toISO(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: toISO(today),
    };
  if (period === "quarter") {
    const qm = Math.floor(today.getMonth() / 3) * 3;
    return {
      start: toISO(new Date(today.getFullYear(), qm, 1)),
      end: toISO(today),
    };
  }
  if (period === "year")
    return {
      start: toISO(new Date(today.getFullYear(), 0, 1)),
      end: toISO(today),
    };
  return { start: null, end: null };
}

const PERIOD_KEYS = [
  { key: "month", tKey: "period_month_dues" },
  { key: "quarter", tKey: "period_quarter_dues" },
  { key: "year", tKey: "period_year_dues" },
  { key: "all", tKey: "period_all_dues" },
];

// ── Avatar icon based on name ────────────────────────────────
function AvatarIcon({ name }) {
  const words = (name || "").trim().split(/\s+/);
  const isOrg =
    words.length > 1 &&
    /store|enterprises|pvt|ltd|co\.|trading|shop|mart|general/i.test(name);
  const bg = isOrg ? "#E8EAF6" : "#E3F2FD";
  const icon = isOrg ? (
    // Store icon
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
        stroke="#00695C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 22V12h6v10"
        stroke="#00695C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    // Person icon
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
        stroke="#00695C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="7"
        r="4"
        stroke="#00695C"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {icon}
    </div>
  );
}

// ── Extract name from description ────────────────────────────
function extractNameFromDesc(desc) {
  if (!desc) return null;
  const m = desc.match(/\b(?:from|to)\s+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)/i);
  if (m) return m[1].trim();
  const stripped = desc.trim();
  if (
    stripped.length > 0 &&
    stripped.split(" ").length <= 4 &&
    !/received|paid|dues|amount|rs|₹/i.test(stripped)
  )
    return stripped;
  return null;
}

function cleanDesc(desc, personName) {
  if (!desc) return "Payment received";
  if (personName && desc.toLowerCase().includes(personName.toLowerCase())) {
    return (
      desc
        .replace(new RegExp(`\\s*(?:from|to)\\s+${personName}`, "i"), "")
        .replace(/\s+dated[\s\d\-\/]+$/i, "")
        .trim() || "Payment received"
    );
  }
  return desc;
}

// ── Pending dues card ────────────────────────────────────────
function DuesCard({ due, phone, language, onContactSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState(null);
  const [loadingH, setLoadingH] = useState(false);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);

  const days = due.days_overdue || 0;
  const color = daysColor(days);

  async function toggleExpand() {
    if (!expanded && !history) {
      setLoadingH(true);
      try {
        const res = await fetchPersonDuesHistory(phone, due.person_name);
        setHistory(res);
      } catch {
        setHistory({ transactions: [] });
      } finally {
        setLoadingH(false);
      }
    }
    setExpanded((e) => !e);
  }

  async function handleSaveContact(e) {
    e.preventDefault();
    if (!contact.replace(/\D/g, "").length) return;
    setSaving(true);
    try {
      await onContactSaved(due.person_name, contact);
      setEditing(false);
    } catch (err) {
      alert("Could not save: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  const txns = history?.transactions || [];

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        marginBottom: 10,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={toggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 14px",
          cursor: "pointer",
        }}
      >
        <AvatarIcon name={due.person_name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>
            {due.person_name}
          </div>
          {/*<div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
            {due.phone ? (
              <a
                href={`tel:${due.phone}`}
                style={{ color: "#00695C", textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                📞 {due.phone}
              </a>
            ) : (
              <span style={{ color: "#bbb" }}>{t("no_contact", language)}</span>
            )}
          </div>*/}
          {/* Given / Paid pills */}
          {(due.total_given > 0 || due.total_received > 0) && (
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
              <span
                style={{
                  fontSize: 10,
                  background: "#FFF3E0",
                  color: "#E65100",
                  fontWeight: 700,
                  borderRadius: 5,
                  padding: "2px 7px",
                }}
              >
                {t('given_label', language)} {fmtRs(due.total_given)}
              </span>
              {due.total_received > 0 && (
                <span
                  style={{
                    fontSize: 10,
                    background: "#E8F5E9",
                    color: "#2E7D32",
                    fontWeight: 700,
                    borderRadius: 5,
                    padding: "2px 7px",
                  }}
                >
                  {t('paid_suffix', language)} {fmtRs(due.total_received)}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#E53935" }}>
            {fmtRs(due.balance)}
          </div>
          <div style={{ fontSize: 10, color, fontWeight: 600, marginTop: 2 }}>
            {days > 0 ? `${days}${t('overdue_days', language)}` : t('today_text', language)}
          </div>
          <div style={{ fontSize: 10, color: "#ccc", marginTop: 2 }}>
            {expanded ? "▲" : "▼"}
          </div>
        </div>
      </div>

      {/* Add contact 
      {!due.phone && !editing && !expanded && (
        <div style={{ padding: "0 14px 10px" }}>
          <button
            onClick={() => setEditing(true)}
            style={{
              fontSize: 11,
              color: "#00695C",
              background: "#E8F5E9",
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            + Add contact
          </button>
        </div>
      )}*/}
      {editing && (
        <form
          onSubmit={handleSaveContact}
          style={{
            display: "flex",
            gap: 6,
            padding: "0 14px 10px",
            alignItems: "center",
          }}
        >
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            placeholder="10 digit number"
            value={contact}
            onChange={(e) =>
              setContact(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            disabled={saving}
            style={{
              background: "#00695C",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            style={{
              background: "#f5f5f5",
              border: "none",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </form>
      )}

      {/* Expanded ledger */}
      {expanded && (
        <div
          style={{ borderTop: "1px solid #f5f5f5", padding: "8px 14px 10px" }}
        >
          {loadingH ? (
            <div style={{ fontSize: 12, color: "#aaa", padding: "6px 0" }}>
              {t("loading", language)}
            </div>
          ) : txns.length === 0 ? (
            <div style={{ fontSize: 12, color: "#aaa", padding: "6px 0" }}>
              {t("no_history", language)}
            </div>
          ) : (
            txns.map((txn, i) => {
              const isGiven = txn.type === "given";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom:
                      i < txns.length - 1 ? "1px solid #f5f5f5" : "none",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 4,
                          padding: "1px 5px",
                          background: isGiven ? "#FFF3E0" : "#E8F5E9",
                          color: isGiven ? "#E65100" : "#2E7D32",
                        }}
                      >
                        {isGiven
                          ? t("given_badge", language)
                          : t("received_badge", language)}
                      </span>
                      <span style={{ fontSize: 12, color: "#555" }}>
                        {txn.description ||
                          (isGiven
                            ? t("udhaar_given", language)
                            : t("udhaar_received", language))}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>
                      {fmtDate(txn.date)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", marginLeft: 8 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: isGiven ? "#E65100" : "#2E7D32",
                      }}
                    >
                      {isGiven ? "+" : "−"}
                      {fmtRs(txn.amount)}
                    </div>
                    <div style={{ fontSize: 10, color: "#aaa" }}>
                      bal: {fmtRs(txn.running_bal)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {!due.phone && !editing && (
            <button
              onClick={() => setEditing(true)}
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "#00695C",
                background: "#E8F5E9",
                border: "none",
                borderRadius: 6,
                padding: "4px 10px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              + Add contact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Received card ────────────────────────────────────────────
function ReceivedCard({ rec, language }) {
  const [expanded, setExpanded] = useState(false);

  // Extract clean name — person_name may still be a full sentence if migration hasn't run
  const rawName = rec.person_name || "";
  const displayName =
    rawName.split(" ").length > 3 || /dues|given|received|dated/i.test(rawName)
      ? extractNameFromDesc(rawName) ||
        extractNameFromDesc(rec.recent?.[0]?.description || "") ||
        rawName
      : rawName ||
        extractNameFromDesc(rec.recent?.[0]?.description || "") ||
        "Unknown";

  const hasPending = rec.net_pending > 0;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        marginBottom: 10,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 14px",
          cursor: rec.recent?.length > 0 ? "pointer" : "default",
        }}
      >
        {/* Green check circle */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#E8F5E9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#43A047" />
            <path
              d="M8 12l3 3 5-5"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>
            {displayName}
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
            {rec.txn_count} {rec.txn_count !== 1 ? t('payments_received', language) : t('payment_received_single', language)} ·
            {fmtDate(rec.last_date)}
          </div>
          {hasPending ? (
            <span
              style={{
                fontSize: 10,
                background: "#FFF3E0",
                color: "#E65100",
                fontWeight: 700,
                borderRadius: 5,
                padding: "2px 7px",
                marginTop: 4,
                display: "inline-block",
              }}
            >
              ⏳ {t('still_pending', language)} {fmtRs(rec.net_pending)}
            </span>
          ) : (
            <span
              style={{
                fontSize: 10,
                background: "#E8F5E9",
                color: "#2E7D32",
                fontWeight: 700,
                borderRadius: 5,
                padding: "2px 7px",
                marginTop: 4,
                display: "inline-block",
              }}
            >
              ✅ {t('fully_cleared', language)}
            </span>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#2E7D32" }}>
            +{fmtRs(rec.total_received)}
          </div>
          {rec.recent?.length > 0 && (
            <div style={{ fontSize: 10, color: "#ccc", marginTop: 4 }}>
              {expanded ? "▲" : "▼"}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div
          style={{ borderTop: "1px solid #f5f5f5", padding: "8px 14px 10px" }}
        >
          {/* Dues given row — when credit was originally extended */}
          {rec.dues_given_date && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "5px 0",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  {t('dues_given_to', language)} {displayName}
                </div>
                <div style={{ fontSize: 11, color: "#bbb" }}>
                  {fmtDate(rec.dues_given_date)}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#E65100" }}>
                −{fmtRs(rec.dues_given_amount || rec.total_received)}
              </div>
            </div>
          )}
          {/* Payment received rows */}
          {(rec.recent || []).map((txn, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "5px 0",
                borderBottom:
                  i < rec.recent.length - 1 ? "1px solid #f5f5f5" : "none",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "#555" }}>
                  {t('payment_received_label', language)}
                </div>
                <div style={{ fontSize: 11, color: "#bbb" }}>
                  {fmtDate(txn.date)}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#2E7D32" }}>
                +{fmtRs(txn.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Staff card ───────────────────────────────────────────────
function StaffCard({ member, language }) {
  const [expanded, setExpanded] = useState(false);
  const isNeg = member.net_total < 0;
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        marginBottom: 10,
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 14px",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#FFF3E0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 22 }}>👷</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>
            {member.name}
          </div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
            {(member.recent_payments || []).length} {(member.recent_payments || []).length !== 1 ? t('transactions_in_period', language) : t('transaction_in_period', language)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              color: isNeg ? "#2E7D32" : "#E65100",
            }}
          >
            {isNeg ? "+" : "−"}
            {fmtRs(Math.abs(member.net_total))}
          </div>
          <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
            {isNeg ? t('received_more_staff', language) : t('net_paid_staff', language)}
          </div>
          <div style={{ fontSize: 10, color: "#ccc", marginTop: 2 }}>
            {expanded ? "▲" : "▼"}
          </div>
        </div>
      </div>
      {expanded && (
        <div
          style={{ borderTop: "1px solid #f5f5f5", padding: "8px 14px 10px" }}
        >
          {member.recent_payments?.length > 0 ? (
            member.recent_payments.map((p, i) => {
              const isReceipt = p.type === "receipt";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "5px 0",
                    borderBottom:
                      i < member.recent_payments.length - 1
                        ? "1px solid #f5f5f5"
                        : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      {p.description || (isReceipt ? t('received_badge', language) : t('payments_label', language))}
                    </div>
                    <div style={{ fontSize: 11, color: "#bbb" }}>{p.date}</div>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: isReceipt ? "#2E7D32" : "#E65100",
                    }}
                  >
                    {isReceipt ? "+" : "−"}
                    {fmtRs(p.amount)}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 12, color: "#aaa" }}>
              {t("no_payments", language)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main DuesPage ────────────────────────────────────────────
export default function DuesPage({ phone, storeName, language = "hinglish", refreshKey }) {
  const [tab, setTab] = useState("dues");
  const [period, setPeriod] = useState("all");
  const [dues, setDues] = useState([]);
  const [duesReceived, setDuesReceived] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAllPending, setShowAllPending] = useState(false);
  const [showAllReceived, setShowAllReceived] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === "dues") {
          const { start, end } = getRange(period);
          const res = await fetchDues(phone, start, end);
          setDues(res.dues || []);
          setDuesReceived(res.dues_received || []);
        } else {
          const { start, end } = getRange(period);
          const res = await fetchStaff(phone, start, end);
          setStaff(res.staff || []);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [phone, tab, period, refreshKey]);

  async function handleContactSaved(personName, contactPhone) {
    await updateDuesContact(phone, personName, contactPhone);
    const { start, end } = getRange(period);
    const res = await fetchDues(phone, start, end);
    setDues(res.dues || []);
    setDuesReceived(res.dues_received || []);
  }

  const totalPending = dues.reduce((s, d) => s + (d.balance || 0), 0);
  const totalReceived = duesReceived.reduce(
    (s, r) => s + (r.total_received || 0),
    0,
  );
  const totalOutstanding = totalPending;
  const totalTxnsPending = dues.reduce(
    (s, d) => s + (d.recent_transactions?.length || 1),
    0,
  );
  const totalStaffExpense = staff.reduce(
    (s, m) => s + (m.net_total > 0 ? m.net_total : 0),
    0,
  );
  const totalStaffReceived = staff.reduce(
    (s, m) => s + (m.net_total < 0 ? Math.abs(m.net_total) : 0),
    0,
  );

  const PREVIEW = 3;
  const visiblePending = showAllPending ? dues : dues.slice(0, PREVIEW);
  const visibleReceived = showAllReceived
    ? duesReceived
    : duesReceived.slice(0, PREVIEW);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#F4F6F8",
        overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: "#00695C",
          padding: "14px 16px 10px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                background: "rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 20 }}>👤</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>
                {storeName || "Dues & Staff"}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                {t("dues_status", language)}
              </div>
            </div>
          </div>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 18 }}>🔔</span>
          </div>
        </div>

        {/* Tabs inside header */}
        <div
          style={{
            display: "flex",
            background: "rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {[
            { key: "dues", tKey: "tab_dues_label" },
            { key: "staff", tKey: "tab_staff_label" },
          ].map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                background: tab === tb.key ? "#fff" : "transparent",
                color: tab === tb.key ? "#00695C" : "rgba(255,255,255,0.7)",
                transition: "all 0.15s",
              }}
            >
              {t(tb.tKey, language)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Period selector ── */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "8px 12px",
          background: "#fff",
          borderBottom: "1px solid #eee",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {PERIOD_KEYS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: "5px 13px",
              borderRadius: 16,
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              background: period === p.key ? "#00695C" : "#F0F0F0",
              color: period === p.key ? "#fff" : "#555",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t(p.tKey, language)}
          </button>
        ))}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 80px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 32, color: "#aaa" }}>
            {t("loading", language)}
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: 16, color: "#E53935" }}>
            ⚠️ {error}
          </div>
        )}

        {/* ══ DUES TAB ══ */}
        {!loading && !error && tab === "dues" && (
          <>
            {/* Total Outstanding dark card */}
            <div
              style={{
                background: "linear-gradient(135deg, #00695C 0%, #00897B 100%)",
                borderRadius: 16,
                padding: "20px 20px 18px",
                marginBottom: 14,
                boxShadow: "0 4px 16px rgba(26,35,126,0.3)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.6)",
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  marginBottom: 6,
                }}
              >
                {t('total_outstanding_label', language)}
              </div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  color: "#fff",
                  letterSpacing: -1,
                }}
              >
                {fmtRs(totalOutstanding)}
              </div>
              {dues.length > 0 && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    marginTop: 10,
                    background: "rgba(255,255,255,0.12)",
                    borderRadius: 20,
                    padding: "4px 10px",
                  }}
                >
                  <span style={{ fontSize: 12 }}>👥</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.85)",
                      fontWeight: 600,
                    }}
                  >
                    {dues.length} {dues.length === 1 ? t('person_pending', language) : t('people_pending', language)}
                  </span>
                </div>
              )}
            </div>

            {/* Pending + Received summary cards */}
            <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  borderRadius: 14,
                  padding: "14px 16px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: "#FFEBEE",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 8,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 19V5M5 12l7-7 7 7"
                      stroke="#E53935"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#E53935",
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {t('pending_label', language)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#E53935",
                    marginTop: 2,
                  }}
                >
                  {fmtRs(totalPending)}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  borderRadius: 14,
                  padding: "14px 16px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    background: "#E8F5E9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 8,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" fill="#43A047" />
                    <path
                      d="M8 12l3 3 5-5"
                      stroke="#fff"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#2E7D32",
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {t('received_label_upper', language)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#2E7D32",
                    marginTop: 2,
                  }}
                >
                  {fmtRs(totalReceived)}
                </div>
              </div>
            </div>

            {/* ── Pending Dues ── */}
            {dues.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{ fontWeight: 800, fontSize: 16, color: "#111" }}
                    >
                      {t('pending_dues', language)}
                    </div>
                    <div style={{ fontSize: 12, color: "#999", marginTop: 1 }}>
                      {totalTxnsPending} {t('transactions_pending', language)}
                    </div>
                  </div>
                  {dues.length > PREVIEW && (
                    <button
                      onClick={() => setShowAllPending((v) => !v)}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#00695C",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {showAllPending ? t('show_less', language) : t('view_all', language)}
                    </button>
                  )}
                </div>
                {visiblePending.map((d) => (
                  <DuesCard
                    key={d.person_name}
                    due={d}
                    phone={phone}
                    language={language}
                    onContactSaved={handleContactSaved}
                  />
                ))}
              </div>
            )}

            {/* ── Recently Received ── */}
            {duesReceived.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 16,
                        color: "#2E7D32",
                      }}
                    >
                      {t('recently_received', language)}
                    </div>
                    <div style={{ fontSize: 12, color: "#999", marginTop: 1 }}>
                      {period === "all"
                        ? t('all_time', language)
                        : t(PERIOD_KEYS.find((p) => p.key === period)?.tKey || 'all_time', language)}
                    </div>
                  </div>
                  {duesReceived.length > PREVIEW && (
                    <button
                      onClick={() => setShowAllReceived((v) => !v)}
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#2E7D32",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {showAllReceived ? t('show_less', language) : t('view_all', language)}
                    </button>
                  )}
                </div>
                {visibleReceived.map((r) => (
                  <ReceivedCard key={r.person_name} rec={r} language={language} />
                ))}
              </div>
            )}

            {dues.length === 0 && duesReceived.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#aaa",
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t('no_dues_msg', language)}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {t('no_dues_sub', language)}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ STAFF TAB ══ */}
        {!loading && !error && tab === "staff" && (
          <>
            {/* Staff summary */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  borderRadius: 14,
                  padding: "14px 16px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#E65100",
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {t('paid_out_label', language)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#E65100",
                    marginTop: 2,
                  }}
                >
                  {fmtRs(totalStaffExpense)}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  borderRadius: 14,
                  padding: "14px 16px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#00695C",
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {t('net_staff_label', language)}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#00695C",
                    marginTop: 2,
                  }}
                >
                  {fmtRs(totalStaffExpense - totalStaffReceived)}
                </div>
              </div>
            </div>

            {staff.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#aaa",
                }}
              >
                <div style={{ fontSize: 40, marginBottom: 12 }}>👷</div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {t('no_staff_records', language)}
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    color: "#111",
                    marginBottom: 10,
                  }}
                >
                  {t('staff_members', language)}
                </div>
                {staff.map((s) => (
                  <StaffCard key={s.name} member={s} language={language} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
