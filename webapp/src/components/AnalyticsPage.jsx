import { useState, useEffect } from "react";
import { fetchAnalytics } from "../api.js";
import { t } from "../translations.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRsFull(val) {
  const n = parseFloat(val) || 0;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRs(val) {
  const n = parseFloat(val) || 0;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

const TAG_META = {
  upi: { icon: "💳", color: "#4CAF50" },
  upi_collection: { icon: "💳", color: "#4CAF50" },
  upi_payment: { icon: "💳", color: "#4CAF50" },
  pos: { icon: "🖥️", color: "#1E88E5" },
  pos_collection: { icon: "🖥️", color: "#1E88E5" },
  cash: { icon: "💵", color: "#43A047" },
  cash_collection: { icon: "💵", color: "#43A047" },
  cash_in_hand: { icon: "💵", color: "#43A047" },
  bank: { icon: "🏦", color: "#039BE5" },
  neft: { icon: "🏦", color: "#039BE5" },
  rtgs: { icon: "🏦", color: "#039BE5" },
  imps: { icon: "🏦", color: "#039BE5" },
  staff_expense: { icon: "👷", color: "#FF9800" },
  staff_salary: { icon: "👷", color: "#FF9800" },
  staff: { icon: "👷", color: "#FF9800" },
  cash_discount: { icon: "🏷️", color: "#9C27B0" },
  discount: { icon: "🏷️", color: "#9C27B0" },
  rent: { icon: "🏠", color: "#F44336" },
  electricity: { icon: "⚡", color: "#FFC107" },
  food: { icon: "🍽️", color: "#8BC34A" },
  refreshment: { icon: "☕", color: "#8BC34A" },
  transport: { icon: "🚗", color: "#03A9F4" },
  freight: { icon: "🚚", color: "#03A9F4" },
  purchase: { icon: "🛒", color: "#FF5722" },
  cleaning: { icon: "🧹", color: "#26A69A" },
  office_supplies: { icon: "📎", color: "#78909C" },
  services: { icon: "🔧", color: "#5C6BC0" },
  repair: { icon: "🔧", color: "#5C6BC0" },
  home_expense: { icon: "🏡", color: "#AB47BC" },
  petrol: { icon: "⛽", color: "#EF6C00" },
  packaging: { icon: "📦", color: "#8D6E63" },
  insurance: { icon: "🛡️", color: "#00838F" },
  water: { icon: "💧", color: "#0288D1" },
  telephone: { icon: "📞", color: "#7B1FA2" },
  other: { icon: "📋", color: "#607D8B" },
  uncategorized: { icon: "📋", color: "#9E9E9E" },
  store_expense: { icon: "🏪", color: "#795548" },
  "staff expense": { icon: "👷", color: "#FF9800" },
  shop_supplies: { icon: "🛒", color: "#FF5722" },
  dry_cleaning: { icon: "👔", color: "#5C6BC0" },
};

// Tags that represent payment channels / revenue collections — NOT true expenses
const COLLECTION_KEYWORDS = [
  "upi",
  "pos",
  "cash",
  "neft",
  "rtgs",
  "imps",
  "bank_transfer",
  "paytm",
  "gpay",
  "phonepe",
  "online",
  "digital",
  "collection",
  "receipt",
  "received",
  "settlement",
];

function isCollection(tag) {
  const lower = (tag || "").toLowerCase();
  return COLLECTION_KEYWORDS.some((k) => lower.includes(k));
}

function getMeta(tag) {
  const lower = (tag || "").toLowerCase();
  for (const [key, meta] of Object.entries(TAG_META)) {
    if (lower.includes(key)) return meta;
  }
  return { icon: "📊", color: "#00897B" };
}

function toLabel(tag, customLabels) {
  if (customLabels[tag]) return customLabels[tag];
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Mini bar spark ────────────────────────────────────────────────────────────

function MiniBars({ pct, color }) {
  // 4-bar sparkline; the 3rd bar reflects the actual pct
  const heights = [45, 70, Math.max(20, pct), 85];
  return (
    <svg
      width="34"
      height="24"
      viewBox="0 0 34 24"
      style={{ display: "block" }}
    >
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 9}
          y={24 - (24 * h) / 100}
          width="7"
          height={(24 * h) / 100}
          fill={i === 2 ? color : `${color}55`}
          rx="1.5"
        />
      ))}
    </svg>
  );
}

// ── Edit label modal ──────────────────────────────────────────────────────────

const PERIOD_KEYS = [
  { key: "day", tKey: "period_today" },
  { key: "week", tKey: "period_week" },
  { key: "month", tKey: "period_month" },
  { key: "year", tKey: "period_year" },
];

// ── Date range picker modal ───────────────────────────────────────────────────

function DateRangeModal({ onApply, onClose, language }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 18,
          padding: "24px 20px",
          width: 300,
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#1a1a1a",
            marginBottom: 20,
          }}
        >
          📅 {t('date_range_title', language)}
        </div>

        {[
          { label: t('from_label', language), val: from, set: setFrom },
          { label: t('to_label', language), val: to, set: setTo },
        ].map(({ label, val, set }) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                color: "#888",
                letterSpacing: 0.8,
                marginBottom: 5,
              }}
            >
              {label}
            </div>
            <input
              type="date"
              value={val}
              max={today}
              onChange={(e) => set(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 9,
                border: "1.5px solid #00897B",
                outline: "none",
                fontSize: 14,
                boxSizing: "border-box",
                color: "#1a1a1a",
              }}
            />
          </div>
        ))}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 9,
              border: "1.5px solid #e0e0e0",
              background: "#fff",
              cursor: "pointer",
              fontSize: 14,
              color: "#666",
              fontWeight: 500,
            }}
          >
            {t('cancel_btn', language)}
          </button>
          <button
            onClick={() => {
              if (from && to) onApply(from, to);
            }}
            disabled={!from || !to || from > to}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 9,
              border: "none",
              background: from && to && from <= to ? "#00897B" : "#ccc",
              color: "#fff",
              cursor: from && to && from <= to ? "pointer" : "default",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {t('apply_btn', language)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsPage({
  phone,
  storeName,
  language = "hinglish",
}) {
  const [period, setPeriod] = useState("day");
  const [customRange, setCustomRange] = useState(null); // { start, end } when custom
  const [showDatePick, setShowDatePick] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    const { start, end } = customRange || {};
    fetchAnalytics(phone, period, start || null, end || null)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [phone, period, customRange]);

  function handlePeriodClick(key) {
    setPeriod(key);
    setCustomRange(null); // clear custom range when switching preset
  }

  function handleCustomApply(start, end) {
    setCustomRange({ start, end });
    setPeriod("custom");
    setShowDatePick(false);
  }

  // Label shown on the calendar button when a custom range is active
  const calLabel = customRange
    ? `${customRange.start.slice(5)} → ${customRange.end.slice(5)}` // MM-DD → MM-DD
    : null;

  // ── Build split category lists ───────────────────────────────────────────────
  const kpis = data?.kpis || {};
  const totalExpenses = kpis.total_expenses || 0;

  const { expenseCats, collectionCats } = (() => {
    if (!data) return { expenseCats: [], collectionCats: [] };
    const collections = [];
    let staffTotal = kpis.staff_expenses || 0; // staff_salary from kpis
    let discountTotal = 0;
    const storeExpenseByTag = {}; // tag → amount

    Object.entries(data.expense_tags || {}).forEach(([tag, amt]) => {
      const lower = tag.toLowerCase();

      // ✅ HANDLE DISCOUNT FIRST
      if (lower.includes("discount")) {
        discountTotal += amt;
        return;
      }

      // ❗ THEN check collection
      if (isCollection(tag)) {
        collections.push({ tag, amt });
        return;
      }

      if (lower.includes("staff")) {
        staffTotal += amt;
      } else {
        // Per-category store expense breakdown
        storeExpenseByTag[tag] = (storeExpenseByTag[tag] || 0) + amt;
      }
    });

    const expenses = [];
    if (staffTotal > 0)
      expenses.push({ tag: "staff_expense", amt: staffTotal });
    if (discountTotal > 0)
      expenses.push({ tag: "cash_discount", amt: discountTotal });
    // Add individual store expense categories
    Object.entries(storeExpenseByTag).forEach(([tag, amt]) => {
      if (amt > 0) expenses.push({ tag, amt });
    });

    return {
      expenseCats: expenses.sort((a, b) => b.amt - a.amt),
      collectionCats: collections.sort((a, b) => b.amt - a.amt),
    };
  })();

  const expenseTotal = expenseCats.reduce((s, c) => s + c.amt, 0) || 1;
  const collectionTotal = collectionCats.reduce((s, c) => s + c.amt, 0) || 1;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#F0F4F3",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* ══ Hero card (dark teal) ═══════════════════════════════════════════ */}
      <div
        style={{
          background: "linear-gradient(140deg, #00695C 0%, #00897B 100%)",
          padding: "18px 18px 0",
          boxShadow: "0 4px 24px rgba(0,105,92,0.35)",
          flexShrink: 0,
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              👤
            </div>
            <span
              style={{
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                lineHeight: 1.3,
              }}
            >
              {storeName || "Store"}
              <br />
              <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.8 }}>
                {t('business_insights', language)}
              </span>
            </span>
          </div>
        </div>

        {/* Total expenses */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 10,
              letterSpacing: 2,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {t('total_expenses_label', language)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                color: "#fff",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: -0.5,
              }}
            >
              {loading ? "—" : fmtRsFull(totalExpenses)}
            </div>
          </div>
        </div>

        {/* Period tabs + calendar */}
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          {PERIOD_KEYS.map((p) => (
            <button
              key={p.key}
              onClick={() => handlePeriodClick(p.key)}
              style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: period === p.key ? "#fff" : "rgba(255,255,255,0.55)",
                fontWeight: period === p.key ? 700 : 400,
                fontSize: 13,
                borderBottom:
                  period === p.key
                    ? "2.5px solid #fff"
                    : "2.5px solid transparent",
              }}
            >
              {t(p.tKey, language)}
            </button>
          ))}

          {/* Calendar / custom range button */}
          <button
            onClick={() => setShowDatePick(true)}
            title="Custom date range"
            style={{
              padding: "8px 10px",
              border: "none",
              cursor: "pointer",
              background:
                period === "custom" ? "rgba(255,255,255,0.2)" : "transparent",
              borderRadius: "8px 8px 0 0",
              borderBottom:
                period === "custom"
                  ? "2.5px solid #fff"
                  : "2.5px solid transparent",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
              marginBottom: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>📅</span>
            {calLabel && (
              <span
                style={{
                  fontSize: 9,
                  color: "#fff",
                  opacity: 0.85,
                  lineHeight: 1,
                }}
              >
                {calLabel}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ══ Scrollable body ════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 14px 24px" }}>
        {error && (
          <div
            style={{
              background: "#FFEBEE",
              color: "#C62828",
              padding: "10px 14px",
              borderRadius: 10,
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {loading && (
          <div
            style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>{t('loading', language)}
          </div>
        )}

        {/* ── Expense Categories ─────────────────────────────────────────── */}
        {!loading && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>
                {t('expense_categories', language)}
              </span>
            </div>
            {expenseCats.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  padding: 24,
                  textAlign: "center",
                  color: "#aaa",
                  fontSize: 14,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                {t('no_expenses_period', language)}
              </div>
            ) : (
              expenseCats.map(({ tag, amt }) => {
                const pct =
                  totalExpenses > 0
                    ? Math.round((amt / totalExpenses) * 100)
                    : 0;
                const { icon, color } = getMeta(tag);
                return (
                  <div
                    key={tag}
                    style={{
                      background: "#fff",
                      borderRadius: 14,
                      padding: "14px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: `${color}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 22,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 10,
                          color: "#999",
                          fontWeight: 700,
                          letterSpacing: 1,
                          marginBottom: 2,
                        }}
                      >
                        {toLabel(tag, {}).toUpperCase()}
                      </div>
                      <div
                        style={{
                          fontSize: 20,
                          fontWeight: 800,
                          color: "#1a1a1a",
                          lineHeight: 1.2,
                        }}
                      >
                        {fmtRs(amt)}
                      </div>
                      <div
                        style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}
                      >
                        {pct}% {t('of_total', language)}
                      </div>
                    </div>
                    <MiniBars pct={pct} color={color} />
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Collections / Revenue Channels ────────────────────────────────── */}
        {!loading && collectionCats.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>
                {t('revenue_channels', language)}
              </span>
              <span style={{ fontSize: 11, color: "#888" }}>
                {t('how_money_in', language)}
              </span>
            </div>
            {collectionCats.map(({ tag, amt }) => {
              const pct = Math.round((amt / collectionTotal) * 100);
              const { icon, color } = getMeta(tag);
              return (
                <div
                  key={tag}
                  style={{
                    background: "#fff",
                    borderRadius: 14,
                    padding: "14px",
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: `${color}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                    }}
                  >
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#999",
                        fontWeight: 700,
                        letterSpacing: 1,
                        marginBottom: 2,
                      }}
                    >
                      {toLabel(tag, {}).toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 800,
                        color: "#1a1a1a",
                        lineHeight: 1.2,
                      }}
                    >
                      {fmtRs(amt)}
                    </div>
                    <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>
                      {pct}% {t('of_collections', language)}
                    </div>
                  </div>
                  <MiniBars pct={pct} color={color} />
                </div>
              );
            })}
          </div>
        )}

        {/* ── Expense Composition ───────────────────────────────────────────── */}
        {!loading && expenseCats.length > 0 && (
          <div
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: "16px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                letterSpacing: 1.5,
                marginBottom: 12,
              }}
            >
              {t('expense_composition', language)}
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 6,
                overflow: "hidden",
                display: "flex",
                marginBottom: 14,
              }}
            >
              {expenseCats.map(({ tag, amt }) => (
                <div
                  key={tag}
                  style={{
                    width: `${(amt / expenseTotal) * 100}%`,
                    background: getMeta(tag).color,
                    transition: "width 0.4s ease",
                  }}
                />
              ))}
            </div>
            {expenseCats.map(({ tag, amt }) => {
              const pct = Math.round((amt / expenseTotal) * 100);
              const { color } = getMeta(tag);
              return (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 7,
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 12, color: "#555", flex: 1 }}>
                    {toLabel(tag, {}).toUpperCase()}
                  </span>
                  <span
                    style={{ fontSize: 12, color: "#888", fontWeight: 700 }}
                  >
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ══ Custom date range picker ════════════════════════════════════════════ */}
      {showDatePick && (
        <DateRangeModal
          onApply={handleCustomApply}
          onClose={() => setShowDatePick(false)}
          language={language}
        />
      )}
    </div>
  );
}
