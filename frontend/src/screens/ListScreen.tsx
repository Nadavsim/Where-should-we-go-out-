import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../api'
import { PlaceCard } from '../components/PlaceCard'
import type { ToastState } from '../components/Toast'
import { formatDate } from '../format'
import type { Circle, ListInfo, Place, RankedPlace } from '../types'

interface Props {
  api: Api
  circle: Circle
  listId: string
  tonight: string[]
  onBack: () => void
  onToast: (t: ToastState) => void
  onError: (e: unknown) => void
}

export function ListScreen({ api, circle, listId, tonight, onBack, onToast, onError }: Props) {
  const [list, setList] = useState<ListInfo | null>(null)
  const [places, setPlaces] = useState<RankedPlace[] | null>(null)
  const [editing, setEditing] = useState(false)
  const tonightKey = tonight.join(',')

  const load = useCallback(async () => {
    try {
      const data = await api.recommendations(listId, tonightKey.split(','))
      setList(data.list)
      setPlaces(data.places)
    } catch (e) {
      onError(e)
    }
  }, [api, listId, tonightKey, onError])

  useEffect(() => {
    load()
  }, [load])

  async function logVisit(place: RankedPlace, attendees: string[], date: string) {
    try {
      const visit = await api.logVisit(place.id, attendees, date)
      await load()
      onToast({
        message: `Logged ${place.name} · ${formatDate(date)}`,
        action: {
          label: 'Undo',
          run: () => {
            api.deleteVisit(visit.id).then(load, onError)
          },
        },
      })
    } catch (e) {
      onError(e)
      throw e
    }
  }

  if (!list || !places) {
    return (
      <section>
        <BackButton onBack={onBack} />
        <p className="muted">Loading…</p>
      </section>
    )
  }

  const tracker = places.length === 1

  return (
    <section>
      <BackButton onBack={onBack} />
      <div className="title-row">
        <h1>{list.name}</h1>
        <button className="link-button" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {!list.active && (
        <p className="muted">
          This list was removed.{' '}
          <button className="link-button" onClick={() => api.updateList(list.id, { active: true }).then(load, onError)}>
            Restore it
          </button>
        </p>
      )}

      {editing ? (
        <EditList
          api={api}
          list={list}
          onChanged={load}
          onRemoved={onBack}
          onToast={onToast}
          onError={onError}
        />
      ) : places.length === 0 ? (
        <p className="muted">
          No places yet.{' '}
          <button className="link-button" onClick={() => setEditing(true)}>
            Add one
          </button>
        </p>
      ) : (
        <>
          {!tracker && <p className="muted small">Most overdue for tonight's group first.</p>}
          <div className="cards">
            {places.map((p, i) => (
              <PlaceCard
                key={p.id}
                api={api}
                circle={circle}
                place={p}
                rank={tracker ? null : i + 1}
                tonight={tonight}
                onLogged={logVisit}
                onChanged={load}
                onError={onError}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button className="link-button back" onClick={onBack}>
      ← All lists
    </button>
  )
}

interface EditProps {
  api: Api
  list: ListInfo
  onChanged: () => Promise<void>
  onRemoved: () => void
  onToast: (t: ToastState) => void
  onError: (e: unknown) => void
}

// Everyone in the group can edit. Removing only hides things (history is
// kept), and every removal can be undone.
function EditList({ api, list, onChanged, onRemoved, onToast, onError }: EditProps) {
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [form, setForm] = useState({ name: '', link: '', notes: '' })

  const load = useCallback(async () => {
    try {
      setPlaces(await api.places(list.id, true))
    } catch (e) {
      onError(e)
    }
  }, [api, list.id, onError])

  useEffect(() => {
    load()
  }, [load])

  const refresh = async () => {
    await Promise.all([load(), onChanged()])
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      await refresh()
    } catch (e) {
      onError(e)
    }
  }

  async function addPlace(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    await run(async () => {
      await api.createPlace(list.id, {
        name: form.name,
        ...(form.link.trim() ? { link: form.link.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes } : {}),
      })
      setForm({ name: '', link: '', notes: '' })
    })
  }

  async function editPlace(p: Place) {
    const name = window.prompt('Name', p.name)?.trim()
    if (name === undefined) return
    const link = window.prompt('Link (Google Maps, Instagram… - leave empty for none)', p.link ?? '')
    if (link === null) return
    const notes = window.prompt('Notes (optional)', p.notes ?? '')
    if (notes === null) return
    await run(() => api.updatePlace(p.id, { name: name || p.name, link: link.trim(), notes: notes.trim() }))
  }

  async function setActive(p: Place, active: boolean) {
    await run(() => api.updatePlace(p.id, { active }))
    if (!active) {
      onToast({
        message: `Removed ${p.name}`,
        action: { label: 'Undo', run: () => void run(() => api.updatePlace(p.id, { active: true })) },
      })
    }
  }

  async function renameList() {
    const name = window.prompt('List name', list.name)?.trim()
    if (!name || name === list.name) return
    await run(() => api.updateList(list.id, { name }))
  }

  async function removeList() {
    if (!window.confirm(`Remove the "${list.name}" list? Its places and history are kept.`)) return
    try {
      await api.updateList(list.id, { active: false })
      onToast({
        message: `Removed ${list.name}`,
        action: { label: 'Undo', run: () => void api.updateList(list.id, { active: true }).catch(onError) },
      })
      onRemoved()
    } catch (e) {
      onError(e)
    }
  }

  if (!places) return <p className="muted">Loading…</p>
  const active = places.filter((p) => p.active)
  const removed = places.filter((p) => !p.active)

  return (
    <div className="edit">
      <ul className="edit-list">
        {active.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <span className="row">
              <button className="link-button" onClick={() => editPlace(p)}>
                Edit
              </button>
              <button className="link-button danger" onClick={() => setActive(p, false)}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form className="stacked-form" onSubmit={addPlace}>
        <p className="label">Add a place</p>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name"
          maxLength={80}
          aria-label="Place name"
        />
        <input
          value={form.link}
          onChange={(e) => setForm({ ...form, link: e.target.value })}
          placeholder="Link (optional)"
          type="url"
          aria-label="Link"
        />
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Notes (optional)"
          maxLength={300}
          aria-label="Notes"
        />
        <button className="primary" type="submit" disabled={!form.name.trim()}>
          Add place
        </button>
      </form>

      {removed.length > 0 && (
        <details className="removed">
          <summary>Removed places ({removed.length})</summary>
          <ul className="edit-list">
            {removed.map((p) => (
              <li key={p.id}>
                <span className="muted">{p.name}</span>
                <button className="link-button" onClick={() => setActive(p, true)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="row list-actions">
        <button className="secondary" onClick={renameList}>
          Rename list
        </button>
        {list.active && (
          <button className="secondary danger" onClick={removeList}>
            Remove list
          </button>
        )}
      </div>
    </div>
  )
}
