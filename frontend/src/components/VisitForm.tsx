import { useState } from 'react'
import { todayIso } from '../format'
import type { Member } from '../types'

interface Props {
  members: Member[]
  initial: string[]
  onSave: (attendees: string[], date: string) => Promise<void>
  onCancel: () => void
}

// "We went here": tonight's people pre-selected, date defaults to today.
export function VisitForm({ members, initial, onSave, onCancel }: Props) {
  const [who, setWho] = useState<string[]>(initial)
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const chosen = new Set(who)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(who, date)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="visit-form" onSubmit={submit}>
      <p className="label">Who went?</p>
      <div className="chips small">
        {members.map((m) => (
          <button
            type="button"
            key={m.id}
            className="chip"
            aria-pressed={chosen.has(m.id)}
            onClick={() => setWho(chosen.has(m.id) ? who.filter((x) => x !== m.id) : [...who, m.id])}
          >
            {m.name}
          </button>
        ))}
      </div>
      <label className="label">
        When?
        <input type="date" value={date} max={todayIso()} required onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" type="submit" disabled={saving || who.length === 0 || !date}>
          Save visit
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
