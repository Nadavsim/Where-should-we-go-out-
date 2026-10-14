import { useState } from 'react'
import type { Api } from '../api'
import type { Circle } from '../types'

interface Props {
  api: Api
  circle: Circle
  selected: string[]
  onChange: (ids: string[]) => void
  onDone: () => void
  onMembersChanged: () => Promise<void>
  onError: (e: unknown) => void
}

export function WhoScreen({ api, circle, selected, onChange, onDone, onMembersChanged, onError }: Props) {
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState('')
  const chosen = new Set(selected)

  const toggle = (id: string) =>
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id])

  const allSelected = circle.members.every((m) => chosen.has(m.id))

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      const member = await api.addMember(name)
      setNewName('')
      await onMembersChanged()
      onChange([...selected, member.id])
    } catch (err) {
      onError(err)
    }
  }

  async function rename(id: string, current: string) {
    const name = window.prompt('Rename', current)?.trim()
    if (!name || name === current) return
    try {
      await api.updateMember(id, { name })
      await onMembersChanged()
    } catch (err) {
      onError(err)
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from the group? Their past visits are kept.`)) return
    try {
      await api.updateMember(id, { active: false })
      onChange(selected.filter((x) => x !== id))
      await onMembersChanged()
    } catch (err) {
      onError(err)
    }
  }

  return (
    <section>
      <p className="eyebrow">{circle.name}</p>
      <h1>Who's coming tonight?</h1>

      {!editing ? (
        <>
          <div className="chips">
            {circle.members.map((m) => (
              <button
                key={m.id}
                className="chip"
                aria-pressed={chosen.has(m.id)}
                onClick={() => toggle(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="row">
            <button
              className="link-button"
              onClick={() => onChange(allSelected ? [] : circle.members.map((m) => m.id))}
            >
              {allSelected ? 'Clear' : 'Everyone'}
            </button>
            <button className="link-button" onClick={() => setEditing(true)}>
              Edit people
            </button>
          </div>
          <button className="primary wide" disabled={selected.length === 0} onClick={onDone}>
            {selected.length === 0 ? 'Pick at least one person' : `Where should we go? (${selected.length})`}
          </button>
        </>
      ) : (
        <>
          <ul className="edit-list">
            {circle.members.map((m) => (
              <li key={m.id}>
                <span>{m.name}</span>
                <span className="row">
                  <button className="link-button" onClick={() => rename(m.id, m.name)}>
                    Rename
                  </button>
                  {circle.members.length > 1 && (
                    <button className="link-button danger" onClick={() => remove(m.id, m.name)}>
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={addMember}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add a person"
              maxLength={80}
              aria-label="New person's name"
            />
            <button className="primary" type="submit" disabled={!newName.trim()}>
              Add
            </button>
          </form>
          <button className="secondary wide" onClick={() => setEditing(false)}>
            Done editing
          </button>
        </>
      )}
    </section>
  )
}
