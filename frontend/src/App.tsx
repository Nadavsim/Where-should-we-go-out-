import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, makeApi } from './api'
import { Toast, type ToastState } from './components/Toast'
import { ListScreen } from './screens/ListScreen'
import { ListsScreen } from './screens/ListsScreen'
import { WhoScreen } from './screens/WhoScreen'
import type { Circle } from './types'

// The group's token lives in the path: /c/<token>. Screens live in the hash
// (#who, #list/<id>) so the phone's back button moves between them.
function readToken(): string | null {
  const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

type Route = { kind: 'who' } | { kind: 'lists' } | { kind: 'list'; listId: string }

function readRoute(): Route {
  const hash = window.location.hash.slice(1)
  if (hash === 'who') return { kind: 'who' }
  if (hash.startsWith('list/')) return { kind: 'list', listId: hash.slice(5) }
  return { kind: 'lists' }
}

function useRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const go = useCallback((hash: string) => {
    window.location.hash = hash
  }, [])
  return [route, go]
}

const storageKey = (token: string) => `wsgo:${token}:tonight`

function loadTonight(token: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(token))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export default function App() {
  const token = useMemo(() => readToken(), [])
  if (!token) return <NoGroup />
  return <GroupApp token={token} />
}

function NoGroup() {
  return (
    <main className="app">
      <h1>Where should we go out?</h1>
      <p className="muted">Open the link your group shared with you to get started.</p>
    </main>
  )
}

function GroupApp({ token }: { token: string }) {
  const api = useMemo(() => makeApi(token), [token])
  const [circle, setCircle] = useState<Circle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tonight, setTonightState] = useState<string[]>(() => loadTonight(token))
  const [toast, setToast] = useState<ToastState | null>(null)
  const [route, go] = useRoute()

  const reloadCircle = useCallback(async () => {
    try {
      setCircle(await api.circle())
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This group link doesn't work - ask for a fresh one." : String((e as Error).message))
    }
  }, [api])

  useEffect(() => {
    reloadCircle()
  }, [reloadCircle])

  const setTonight = useCallback(
    (ids: string[]) => {
      setTonightState(ids)
      try {
        localStorage.setItem(storageKey(token), JSON.stringify(ids))
      } catch {
        // storage blocked - the selection just won't be remembered
      }
    },
    [token],
  )

  const closeToast = useCallback(() => setToast(null), [])

  const showError = useCallback((e: unknown) => {
    setToast({ message: e instanceof Error ? e.message : 'Something went wrong.' })
  }, [])

  // With nobody picked yet, stay on the "who's coming" screen until they
  // press Done - not the moment the first person is tapped.
  const nobodyPicked = circle !== null && !tonight.some((id) => circle.members.some((m) => m.id === id))
  useEffect(() => {
    if (nobodyPicked && route.kind !== 'who') window.location.replace('#who')
  }, [nobodyPicked, route.kind])

  if (error) {
    return (
      <main className="app">
        <h1>Where should we go out?</h1>
        <p className="muted">{error}</p>
      </main>
    )
  }
  if (!circle) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  // Drop anyone removed from the group since the selection was saved.
  const activeIds = new Set(circle.members.map((m) => m.id))
  const tonightActive = tonight.filter((id) => activeIds.has(id))
  const needsWho = route.kind === 'who' || nobodyPicked

  return (
    <main className="app">
      {needsWho ? (
        <WhoScreen
          api={api}
          circle={circle}
          selected={tonightActive}
          onChange={setTonight}
          onDone={() => go('')}
          onMembersChanged={reloadCircle}
          onError={showError}
        />
      ) : route.kind === 'list' ? (
        <ListScreen
          key={route.listId}
          api={api}
          circle={circle}
          listId={route.listId}
          tonight={tonightActive}
          onBack={() => go('')}
          onToast={setToast}
          onError={showError}
        />
      ) : (
        <ListsScreen
          api={api}
          circle={circle}
          tonight={tonightActive}
          onChangeWho={() => go('who')}
          onOpenList={(id) => go(`list/${id}`)}
          onError={showError}
        />
      )}
      {toast && <Toast toast={toast} onClose={closeToast} />}
    </main>
  )
}
