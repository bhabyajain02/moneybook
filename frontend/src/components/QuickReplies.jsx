/* Quick reply chips that appear after bot confirmation messages.
   chips prop: array of { label, value, type }
   type: 'confirm' | 'danger' | 'default'                        */

export default function QuickReplies({ chips, onSend }) {
  if (!chips || chips.length === 0) return null
  return (
    <div className="quick-replies">
      {chips.map((c, i) => (
        <button
          key={i}
          className={`chip ${c.type || ''}`}
          onClick={() => onSend(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
