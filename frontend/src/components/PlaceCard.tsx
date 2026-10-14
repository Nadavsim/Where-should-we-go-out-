import { useState } from 'react'
import type { Api } from '../api'
import { daysAgo, formatDate, names } from '../format'
import type { Circle, RankedPlace, VisitRecord } from '../types'
import { VisitForm } from './VisitForm'

interface Props {
  api: Api
  circle: Circle
  place: RankedPlace
  rank: number | null // null for a one-place list (tracker mode)
  tonight: string[]
  onLogged: (place: RankedPlace, attendees: string[], date: string) => Promise<void>
  onChanged: () => void
  onError: (e: unknown) => void
}

export function PlaceCard({ api, circle, place, rank, tonight, onLogged, onChanged, onError }: Props) {
  const [logging, setLogging] = useState(false)
  const [history, setHistory] = useState<VisitRecord[] | null>(null)
  const nameOf = new Map(circle.members.map((m) => [m.id, m.name]))

  async function toggleHistory() {
    if (history) return setHistory(null)
    try {
      setHistory(await api.visits(place.id))
    } catch (e) {
      onError(e)
    }
  }

  async function deleteVisit(v: VisitRecord) {
    if (!window.confirm(`Delete the ${formatDate(v.date)} visit?`)) return
    try {
      await api.deleteVisit(v.id)
      setHistory((h) => h?.filter((x) => x.id !== v.id) ?? null)
      onChanged()
    } catch (e) {
      onError(e)
    }
  }

  const last = place.last_visit

  return (
    <article className={`card place-card${rank === 1 ? ' top' : ''}`}>
      <header className="place-head">
        {rank !== null && <span className="rank">{rank}</span>}
        <div className="place-title">
          <h2>{place.name}</h2>
          {place.notes && <p className="muted small">{place.notes}</p>}
        </div>
        {rank !== null && (
          <span className="score" title="Average days since each of you last went (never counts as a year)">
            {Math.round(place.score)} pts
          </span>
        )}
      </header>

      {rank === null ? (
        <p className="tracker">
          {last ? (
            <>
              Last visit <strong>{formatDate(last.date)}</strong> · {names(last.attendees, circle.members)}
            </>
          ) : (
            'None of you have been yet'
          )}
        </p>
      ) : (
        <ul className="per-person">
          {tonight.map((id) => (
            <li key={id} className={place.days_since[id] === null ? 'never' : undefined}>
              {nameOf.get(id)}: {daysAgo(place.days_since[id] ?? null, circle.never_days)}
            </li>
          ))}
        </ul>
      )}

      {logging ? (
        <VisitForm
          members={circle.members}
          initial={tonight}
          onCancel={() => setLogging(false)}
          onSave={async (attendees, date) => {
            await onLogged(place, attendees, date)
            setLogging(false)
            setHistory(null)
          }}
        />
      ) : (
        <div className="row actions">
          <button className="primary" onClick={() => setLogging(true)}>
            We went here
          </button>
          {place.link && (
            <a className="secondary button" href={place.link} target="_blank" rel="noopener noreferrer">
              Open link
            </a>
          )}
          <button className="link-button" onClick={toggleHistory} aria-expanded={history !== null}>
            History
          </button>
        </div>
      )}

      {history && (
        <ul className="history">
          {history.length === 0 && <li className="muted">No visits logged yet.</li>}
          {history.map((v) => (
            <li key={v.id}>
              <span>
                {formatDate(v.date)} · {names(v.attendees, circle.members)}
              </span>
              <button className="link-button danger" onClick={() => deleteVisit(v)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
