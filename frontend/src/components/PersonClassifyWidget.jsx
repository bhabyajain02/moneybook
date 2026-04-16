import { useState } from 'react'
import { t } from '../translations.js'

const CATEGORY_KEYS = [
  { key: 'staff',         tKey: 'cat_staff',         icon: '👷' },
  { key: 'customer',      tKey: 'cat_customer',      icon: '🛒' },
  { key: 'store_expense', tKey: 'cat_store_expense',  icon: '🏪' },
  { key: 'other',         tKey: 'cat_other',         icon: '📋' },
]

export default function PersonClassifyWidget({ persons, staffOptions: initialStaffOptions, onComplete, onCancel, language }) {
  // { [name]: { category, staffName?, isNewStaff? } }
  const [classifications, setClassifications] = useState({})
  // Track new staff names added during this session so subsequent dropdowns show them
  const [newStaffNames, setNewStaffNames] = useState([])

  // Merged staff options = existing + newly added in this widget
  const allStaffOptions = [...(initialStaffOptions || []), ...newStaffNames]

  function setCategory(name, cat) {
    setClassifications(prev => ({
      ...prev,
      [name]: {
        category: cat,
        staffName: cat === 'staff' ? (prev[name]?.staffName || '') : undefined,
        isNewStaff: cat === 'staff' ? (prev[name]?.isNewStaff || false) : false,
      },
    }))
  }

  function setStaffName(name, staffName) {
    if (staffName === '__new__') {
      // Switch to "add new" mode — show text input
      setClassifications(prev => ({
        ...prev,
        [name]: { ...prev[name], staffName: '', isNewStaff: true },
      }))
      return
    }
    setClassifications(prev => ({
      ...prev,
      [name]: { ...prev[name], staffName, isNewStaff: false },
    }))
  }

  function setNewStaffInput(personName, value) {
    setClassifications(prev => ({
      ...prev,
      [personName]: { ...prev[personName], staffName: value },
    }))
  }

  function confirmNewStaff(personName) {
    const name = classifications[personName]?.staffName?.trim()
    if (name && !newStaffNames.includes(name) && !(initialStaffOptions || []).includes(name)) {
      setNewStaffNames(prev => [...prev, name])
    }
  }

  const allClassified = persons.every(p => {
    const c = classifications[p.name]
    if (!c?.category) return false
    // Staff must have a name selected or entered
    if (c.category === 'staff' && !c.staffName?.trim()) return false
    return true
  })

  function handleDone() {
    if (!allClassified) return
    // Confirm any pending new staff names
    Object.entries(classifications).forEach(([name, c]) => {
      if (c.isNewStaff && c.staffName?.trim()) confirmNewStaff(name)
    })
    onComplete(classifications)
  }

  return (
    <div className="ledger-overlay">
      <div className="ledger-panel classify-widget-panel">
        <div className="ledger-header">
          <span className="ledger-title">{t('classify_title', language)}</span>
          <button className="ledger-close-btn" onClick={onCancel}>✕</button>
        </div>
        <div className="classify-widget-body">
          <p className="classify-widget-hint">{t('classify_hint', language)}</p>
          {persons.map(p => {
            const sel = classifications[p.name]?.category
            const isNew = classifications[p.name]?.isNewStaff
            return (
              <div className="classify-person-card" key={p.name}>
                <div className="classify-person-name">
                  {p.description || p.name}{p.amount ? ` — ₹${Number(p.amount).toLocaleString('en-IN')}` : ''}
                </div>
                <div className="classify-btn-row">
                  {CATEGORY_KEYS.map(c => (
                    <button
                      key={c.key}
                      className={`classify-cat-btn${sel === c.key ? ' active' : ''}`}
                      onClick={() => setCategory(p.name, c.key)}
                    >
                      {c.icon} {t(c.tKey, language)}
                    </button>
                  ))}
                </div>
                {sel === 'staff' && !isNew && (
                  <select
                    className="classify-staff-select"
                    value={classifications[p.name]?.staffName || ''}
                    onChange={e => setStaffName(p.name, e.target.value)}
                  >
                    <option value="">— {t('select_staff_ph', language)} —</option>
                    {allStaffOptions.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    <option value="__new__">➕ {t('add_new_staff', language)}</option>
                  </select>
                )}
                {sel === 'staff' && isNew && (
                  <div className="classify-new-staff-row">
                    <input
                      className="classify-new-staff-input"
                      placeholder={t('new_staff_ph', language)}
                      value={classifications[p.name]?.staffName || ''}
                      onChange={e => setNewStaffInput(p.name, e.target.value)}
                      onBlur={() => confirmNewStaff(p.name)}
                      autoFocus
                    />
                    <button
                      className="classify-back-select-btn"
                      onClick={() => setClassifications(prev => ({
                        ...prev,
                        [p.name]: { ...prev[p.name], staffName: '', isNewStaff: false },
                      }))}
                    >
                      ↩
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="classify-widget-actions">
          <button
            className="classify-continue-btn"
            disabled={!allClassified}
            onClick={handleDone}
          >
            ✅ {t('continue_btn', language)} ({Object.values(classifications).filter(c => {
              if (!c?.category) return false
              if (c.category === 'staff' && !c.staffName?.trim()) return false
              return true
            }).length}/{persons.length})
          </button>
        </div>
      </div>
    </div>
  )
}
