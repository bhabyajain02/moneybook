import { useState, useEffect } from "react";
import { fetchProfile, updateProfile } from "../api.js";
import { t } from "../translations.js";

const SEGMENT_LABELS = {
  textile: "Textile / Clothing",
  grocery: "Grocery / Kirana",
  pharmacy: "Pharmacy / Medicine",
  hardware: "Hardware / Tools",
  food: "Food / Restaurant",
  electronics: "Electronics",
  general: "General Store",
};

const LANGUAGES = [
  { key: "hinglish", label: "Hinglish" },
  { key: "english", label: "English" },
  { key: "hindi", label: "हिंदी" },
  { key: "gujarati", label: "ગુજરાતી" },
  { key: "marathi", label: "मराठी" },
  { key: "bengali", label: "বাংলা" },
  { key: "tamil", label: "தமிழ்" },
  { key: "telugu", label: "తెలుగు" },
  { key: "kannada", label: "ಕನ್ನಡ" },
  { key: "punjabi", label: "ਪੰਜਾਬੀ" },
];

function formatPhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12)
    return `+${digits.slice(0, 2)} ${digits.slice(2, 7)} ${digits.slice(7)}`;
  if (digits.length === 10)
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  return raw?.replace("web:", "") || "—";
}

function formatJoined(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function getInitials(name) {
  if (!name) return "🏪";
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ── Reusable setting row ──────────────────────────────────────
function SettingRow({ icon, title, subtitle, right, onClick, noBorder }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        background: "none",
        border: "none",
        padding: "14px 16px",
        borderBottom: noBorder ? "none" : "1px solid #f2f2f2",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "#EEF4FF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ color: "#aaa", fontSize: 14, flexShrink: 0 }}>
        {right ?? "›"}
      </div>
    </button>
  );
}

// ── Toggle switch ─────────────────────────────────────────────
function Toggle({ on, onChange }) {
  return (
    <div
      onClick={() => onChange(!on)}
      style={{
        width: 48,
        height: 26,
        borderRadius: 13,
        background: on ? "#2E7D32" : "#ccc",
        position: "relative",
        cursor: "pointer",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#fff",
          position: "absolute",
          top: 2,
          left: on ? 24 : 2,
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}

// ── Section header label ──────────────────────────────────────
function SectionLabel({ label }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#999",
        letterSpacing: 1.2,
        padding: "20px 16px 6px",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

// ── White card wrapper ────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Edit modal overlay ────────────────────────────────────────
function EditModal({ profile, onSave, onClose, language }) {
  const [name, setName] = useState(profile?.name || "");
  const [lang, setLang] = useState(profile?.language || "hinglish");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await onSave({ name, language: lang });
    setBusy(false);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "20px 20px 0 0",
          padding: "24px 20px 36px",
          width: "100%",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 17,
            marginBottom: 20,
            color: "#1a1a2e",
          }}
        >
          {t("edit_profile", language)}
        </div>

        <label style={labelSt}>{t("store_name", language)}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputSt}
          placeholder={t("store_name_ph", language)}
        />

        <label style={{ ...labelSt, marginTop: 14 }}>
          {t("lang_setting", language)}
        </label>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          style={inputSt}
        >
          {LANGUAGES.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={btnOutline}>
            {t("cancel", language)}
          </button>
          <button onClick={save} disabled={busy} style={btnBlue}>
            {busy ? t("saving", language) : t("save_changes", language)}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelSt = {
  display: "block",
  fontSize: 12,
  color: "#888",
  fontWeight: 600,
  marginBottom: 6,
};
const inputSt = {
  width: "100%",
  boxSizing: "border-box",
  border: "1.5px solid #e0e0e0",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};
const btnBlue = {
  flex: 1,
  padding: "12px 0",
  background: "#1565C0",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
const btnOutline = {
  flex: 1,
  padding: "12px 0",
  background: "#fff",
  color: "#555",
  border: "1.5px solid #ddd",
  borderRadius: 10,
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

// ── Main ProfilePage ──────────────────────────────────────────
export default function ProfilePage({
  phone,
  storeName,
  language,
  onLanguageChange,
  onStoreNameChange,
  onLogout,
}) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [notifs, setNotifs] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showPlans, setShowPlans] = useState(false);

  useEffect(() => {
    if (!phone) return;
    fetchProfile(phone)
      .then((p) => setProfile(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [phone]);

  async function handleSave({ name, language: lang }) {
    await updateProfile(phone, { name, language: lang });
    setProfile((p) => ({ ...p, name, language: lang }));
    if (lang !== profile?.language && onLanguageChange) onLanguageChange(lang);
    if (name !== storeName && onStoreNameChange) onStoreNameChange(name);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const displayName = profile?.name || storeName || "My Store";
  const segment = SEGMENT_LABELS[profile?.segment] || "General Store";
  // Use the active language from App (prop) — the DB value may be stale until user saves
  const langLabel =
    LANGUAGES.find(
      (l) => l.key === (language || profile?.language || "hinglish"),
    )?.label || "Hinglish";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#f4f6fb",
        overflowY: "auto",
      }}
    >
      {/* ── Top bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 0",
          background: "#f4f6fb",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 32 }} />
        <div style={{ fontWeight: 700, fontSize: 17, color: "#1a1a2e" }}>
          Profile
        </div>
        <div style={{ width: 32, textAlign: "right" }}>
          {saved && <span style={{ fontSize: 18 }}>✅</span>}
        </div>
      </div>

      {/* ── Hero card ── */}
      <div style={{ padding: "14px 16px 0", flexShrink: 0 }}>
        <div
          style={{
            background:
              "linear-gradient(145deg, #1B5E20 0%, #00695C 60%, #00897B 100%)",
            borderRadius: 20,
            padding: "28px 20px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Decorative circles */}
          <div
            style={{
              position: "absolute",
              top: -30,
              left: -30,
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: -20,
              right: -20,
              width: 90,
              height: 90,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.06)",
            }}
          />

          {/* Avatar */}
          <div style={{ position: "relative", marginBottom: 14 }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 20,
                background: "rgba(255,255,255,0.15)",
                border: "2px solid rgba(255,255,255,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                fontWeight: 700,
                color: "#fff",
              }}
            >
              {loading ? "…" : getInitials(displayName)}
            </div>
            {/* Edit pencil */}
            <button
              onClick={() => setEditing(true)}
              style={{
                position: "absolute",
                bottom: -6,
                right: -6,
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "#fff",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                fontSize: 13,
              }}
            >
              ✏️
            </button>
          </div>

          <div
            style={{
              color: "#fff",
              fontWeight: 700,
              fontSize: 20,
              marginBottom: 4,
            }}
          >
            {loading ? "…" : displayName}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            {loading ? "" : segment}
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              width: "100%",
              background: "rgba(255,255,255,0.1)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                flex: 1,
                padding: "12px 0",
                textAlign: "center",
                borderRight: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.6)",
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {t("status_label", language)}
              </div>
              <div
                style={{
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#4CAF50",
                    display: "inline-block",
                  }}
                />
                {t("active_label", language)}
              </div>
            </div>
            <div style={{ flex: 1, padding: "12px 0", textAlign: "center" }}>
              <div
                style={{
                  fontSize: 9,
                  color: "rgba(255,255,255,0.6)",
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {t("joined_label", language)}
              </div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                {loading ? "…" : formatJoined(profile?.joined)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Account Settings ── */}
      <SectionLabel label={t("section_account", language)} />
      <div style={{ padding: "0 16px" }}>
        <Card>
          <SettingRow
            icon="🌐"
            title={t("lang_setting", language)}
            subtitle={langLabel}
            onClick={() => setEditing(true)}
          />
          <SettingRow
            icon="💳"
            title={t("plan_title", language)}
            subtitle={t("plan_subtitle", language)}
            onClick={() => setShowPlans(true)}
            noBorder
          />
        </Card>
      </div>

      {/* ── Preferences ── */}
      <SectionLabel label={t("section_prefs", language)} />
      <div style={{ padding: "0 16px" }}>
        <Card>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#EEF4FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              🔔
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a2e" }}>
                {t("notifs_title", language)}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {t("notifs_subtitle", language)}
              </div>
            </div>
            <Toggle on={notifs} onChange={setNotifs} />
          </div>
        </Card>
      </div>

      {/* ── Support & Info ── */}
      <SectionLabel label={t("section_support", language)} />
      <div style={{ padding: "0 16px" }}>
        <Card>
          <SettingRow
            icon="❓"
            title={t("help_title", language)}
            subtitle={t("help_subtitle", language)}
            right={<span style={{ fontSize: 15 }}>↗</span>}
            onClick={() =>
              window.open("https://wa.me/917600000000?text=Help", "_blank")
            }
          />
          <SettingRow
            icon="🔒"
            title={t("privacy_title", language)}
            subtitle={t("privacy_subtitle", language)}
            noBorder
          />
        </Card>
      </div>

      {/* ── Logout ── */}
      <div style={{ padding: "24px 16px 12px", textAlign: "center" }}>
        <button
          onClick={onLogout}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#D32F2F",
            fontWeight: 700,
            fontSize: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 18 }}>⇥</span> {t("logout", language)}
        </button>
      </div>

      {/* ── Version footer ── */}
      <div
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "#bbb",
          letterSpacing: 1,
          paddingBottom: 24,
        }}
      >
        MONEYBOOK V1.0 • STORE EDITION
      </div>

      {/* ── Edit modal ── */}
      {editing && (
        <EditModal
          profile={{
            ...profile,
            language: language || profile?.language || "hinglish",
          }}
          onSave={handleSave}
          onClose={() => setEditing(false)}
          language={language}
        />
      )}

      {/* ── Plans modal ── */}
      {showPlans && (
        <PlansModal onClose={() => setShowPlans(false)} language={language} />
      )}
    </div>
  );
}

// ── Plans bottom sheet ────────────────────────────────────────
const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "₹0",
    period: "forever",
    color: "#757575",
    current: true,
    features: [
      "Unlimited WhatsApp entries",
      "Daily & monthly summaries",
      "Udhaar tracking",
      "Photo scanning",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "₹299",
    period: "/month",
    color: "#1565C0",
    badge: "⭐ Popular",
    features: [
      "Everything in Free",
      "Analytics dashboard",
      "Staff tracking",
      "CSV export",
      "Up to 3 stores",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: "₹999",
    period: "/month",
    color: "#6A1B9A",
    badge: "🚀 Best Value",
    features: [
      "Everything in Pro",
      "Unlimited stores",
      "Priority support",
      "Custom reports",
      "API access",
    ],
  },
];

function PlansModal({ onClose, language = "hinglish" }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#f4f6fb",
          borderRadius: "20px 20px 0 0",
          padding: "20px 16px 40px",
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 17, color: "#1a1a2e" }}>
            Choose a Plan
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#888",
            }}
          >
            ✕
          </button>
        </div>

        {PLANS.map((plan) => (
          <div
            key={plan.id}
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: "16px",
              marginBottom: 12,
              border: plan.current
                ? `2px solid ${plan.color}`
                : "1.5px solid #e8e8e8",
              position: "relative",
            }}
          >
            {plan.badge && (
              <div
                style={{
                  position: "absolute",
                  top: -10,
                  right: 12,
                  background: plan.color,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: "2px 10px",
                }}
              >
                {plan.badge}
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 10,
              }}
            >
              <div>
                <div
                  style={{ fontWeight: 800, fontSize: 16, color: plan.color }}
                >
                  {plan.name}
                </div>
                {plan.current && (
                  <div
                    style={{ fontSize: 11, color: plan.color, fontWeight: 600 }}
                  >
                    ✓ Current Plan
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <span
                  style={{ fontWeight: 800, fontSize: 20, color: "#1a1a2e" }}
                >
                  {plan.price}
                </span>
                <span style={{ fontSize: 11, color: "#888" }}>
                  {" "}
                  {plan.period}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#555", lineHeight: 1.8 }}>
              {plan.features.map((f, i) => (
                <div key={i}>✅ {f}</div>
              ))}
            </div>
            {!plan.current && (
              <a
                href={`https://wa.me/917600000000?text=Upgrade to MoneyBook ${plan.name}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  marginTop: 12,
                  textAlign: "center",
                  background: plan.color,
                  color: "#fff",
                  padding: "10px",
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                Upgrade to {plan.name} →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
