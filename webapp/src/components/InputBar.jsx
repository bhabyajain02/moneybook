import { useRef, useState } from 'react'

export default function InputBar({ onSend, onImage, onLedger, disabled }) {
  const [text, setText] = useState('')
  const fileRef = useRef()
  const textRef = useRef()

  function handleKey(e) {
    // Enter sends, Shift+Enter = new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
    textRef.current?.focus()
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (file) onImage(file)
    e.target.value = ''   // reset so same file can be re-sent
  }

  // Auto-grow textarea
  function handleInput(e) {
    setText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px'
  }

  return (
    <div className="input-bar">
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {/* Ledger entry button */}
      {onLedger && (
        <button
          className="icon-btn"
          onClick={onLedger}
          disabled={disabled}
          title="Manual entry (Khata Bahi)"
          aria-label="Open ledger entry"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
          </svg>
        </button>
      )}

      {/* Camera / attach button */}
      <button
        className="icon-btn"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        title="Photo bhejein"
        aria-label="Attach image"
      >
        {/* Camera icon */}
        <svg viewBox="0 0 24 24" fill="none" stroke="#667781" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </button>

      {/* Text input */}
      <div className="input-box">
        <textarea
          ref={textRef}
          className="msg-textarea"
          placeholder="Message"
          rows={1}
          value={text}
          onInput={handleInput}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled}
        />
      </div>

      {/* Send button */}
      <button
        className="send-btn"
        onClick={submit}
        disabled={!text.trim() || disabled}
        aria-label="Send"
      >
        {/* Send arrow */}
        <svg viewBox="0 0 24 24">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  )
}
