// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fetchApi } from '@/api/fetchApi'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { layoutStore } from '@/stores/layout'
import { useSubtitles } from './useSubtitles'

vi.mock('@/api/fetchApi', () => ({ fetchApi: vi.fn(async () => ({})) }))
vi.mock('@/features/rooms/livekit/hooks/useRoomData', () => ({
  useRoomData: () => ({
    id: 'main-id',
    livekit: { url: 'https://lk.test', room: 'main-id', token: 'main-token' },
  }),
}))
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn() }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
)

const start = async () => {
  const { result } = renderHook(() => useSubtitles(), { wrapper })
  await act(() => result.current.toggleSubtitles())
  const [url, options] = vi.mocked(fetchApi).mock.calls[0]
  return { url, body: options?.body }
}

afterEach(() => {
  vi.mocked(fetchApi).mockClear()
  layoutStore.showSubtitles = false
  resetBreakout()
})

describe('starting subtitles', () => {
  it('transcribes the breakout room the caller is in', async () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }

    expect(await start()).toEqual({
      url: 'rooms/main-id/start-subtitle/',
      body: JSON.stringify({ breakout_room_id: 'r1' }),
    })
  })

  it('transcribes the meeting itself outside a breakout room', async () => {
    expect(await start()).toEqual({
      url: 'rooms/main-id/start-subtitle/',
      body: undefined,
    })
  })
})
