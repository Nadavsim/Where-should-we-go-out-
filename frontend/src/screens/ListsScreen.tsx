import { useCallback, useEffect, useState } from 'react'
import type { Api } from '../api'
import { daysAgo, formatDate, names } from '../format'
import type { Circle, OverviewList } from '../types'

interface Props {
  api: Api
  circle: Circle
  tonight: string[]
  onChangeWho: () => void
  onOpenList: (id: string) => void
  onError: (e: unknown) => void
}

export function ListsScreen({ api, circle, tonight, onChangeWho, onOpenList, onError }: Props) {
  const [lists, setLists] = useState<OverviewList[] | null>(null)
  const [newList, setNewList] = useState('')
  const tonightKey = tonight.join(',')

  const load = useCallback(async () => {
    try {
      setLists(await api.overview(tonightKey.split(',')))
    } catch (e) {
      onError(e)
    }
  }, [api, tonightKey, onError])

  useEffect(() => {
    load()
  }, [load])

  async function addList(e: React.FormEvent) {
    e.preventDefault()
    const name = newList.trim()
    if (!name) return
    try {
      const created = await api.createList(name)
      setNewList('')
      onOpenList(created.id)
    } catch (err) {
      onError(err)
    }
  }

  return (
    <section>
      <p className="eyebrow">{circle.name}</p>
      <h1>Where should we go?</h1>
      <p className="muted who-line">
        Tonight: {names(tonight, circle.members)}{' '}
        <button className="link-button" onClick={onChangeWho}>
          change
        </button>
      </p>

      {lists === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="cards">
          {lists.length === 0 && <p className="muted">No lists yet - add the first one below.</p>}
          {lists.map((lst) => (
            <button key={lst.id} className="card list-card" onClick={() => onOpenList(lst.id)}>
              <span className="list-name">{lst.name}</span>
              <span className="muted">{summary(lst, circle)}</span>
            </button>
          ))}
        </div>
      )}

      <form className="inline-form" onSubmit={addList}>
        <input
          value={newList}
          onChange={(e) => setNewList(e.target.value)}
          placeholder="New list (e.g. Pizza)"
          maxLength={80}
          aria-label="New list name"
        />
        <button className="primary" type="submit" disabled={!newList.trim()}>
          Add
        </button>
      </form>
    </section>
  )
}

function summary(lst: OverviewList, circle: Circle): string {
  if (!lst.top) return 'No places yet'
  // A one-place list can't recommend anything - it tracks when you last went.
  if (lst.place_count === 1) {
    const v = lst.top.last_visit
    return v ? `Last visit ${formatDate(v.date)} · ${names(v.attendees, circle.members)}` : 'Not been yet'
  }
  const never = Object.values(lst.top.days_since).every((d) => d === null)
  return `Try ${lst.top.name}${never ? ' · none of you have been' : ` · ${lastTogether(lst.top.days_since, circle.never_days)}`}`
}

function lastTogether(days: Record<string, number | null>, neverDays: number): string {
  const seen = Object.values(days).filter((d): d is number => d !== null)
  return `last time ${daysAgo(Math.min(...seen), neverDays)}`
}
