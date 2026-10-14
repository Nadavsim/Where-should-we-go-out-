import type { Circle, ListInfo, Member, OverviewList, Place, RankedPlace, VisitRecord } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = 'Something went wrong - try again.'
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (res.status === 422) message = 'Please check what you typed.'
    } catch {
      // not JSON - keep the generic message
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

// Every call is scoped to one group by the token in its share link.
export function makeApi(token: string) {
  const base = `/api/c/${encodeURIComponent(token)}`
  const members = (ids: string[]) => `members=${ids.map(encodeURIComponent).join(',')}`
  return {
    circle: () => request<Circle>('GET', base),
    addMember: (name: string) => request<Member>('POST', `${base}/members`, { name }),
    updateMember: (id: string, changes: { name?: string; active?: boolean }) =>
      request('PATCH', `${base}/members/${id}`, changes),

    overview: (ids: string[]) => request<OverviewList[]>('GET', `${base}/overview?${members(ids)}`),
    lists: () => request<ListInfo[]>('GET', `${base}/lists`),
    createList: (name: string) => request<ListInfo>('POST', `${base}/lists`, { name }),
    updateList: (id: string, changes: { name?: string; active?: boolean }) =>
      request('PATCH', `${base}/lists/${id}`, changes),

    recommendations: (listId: string, ids: string[]) =>
      request<{ list: ListInfo; places: RankedPlace[] }>(
        'GET',
        `${base}/lists/${listId}/recommendations?${members(ids)}`,
      ),
    places: (listId: string, includeRemoved = false) =>
      request<Place[]>('GET', `${base}/lists/${listId}/places?include_removed=${includeRemoved}`),
    createPlace: (listId: string, place: { name: string; link?: string; notes?: string }) =>
      request<Place>('POST', `${base}/lists/${listId}/places`, place),
    updatePlace: (
      id: string,
      changes: { name?: string; link?: string; notes?: string; active?: boolean; list_id?: string },
    ) => request('PATCH', `${base}/places/${id}`, changes),

    visits: (placeId: string) => request<VisitRecord[]>('GET', `${base}/places/${placeId}/visits`),
    logVisit: (placeId: string, attendees: string[], date: string) =>
      request<VisitRecord>('POST', `${base}/visits`, { place_id: placeId, attendees, date }),
    deleteVisit: (id: string) => request('DELETE', `${base}/visits/${id}`),
  }
}

export type Api = ReturnType<typeof makeApi>
