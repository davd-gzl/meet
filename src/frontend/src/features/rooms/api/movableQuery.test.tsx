// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fetchApi } from '@/api/fetchApi'
import { fetchRoom } from './fetchRoom'
import { requestEntry } from './requestEntry'
import { useCreateRoom } from './createRoom'

vi.mock('@/api/fetchApi', () => ({ fetchApi: vi.fn(async () => ({})) }))

const requested = () => vi.mocked(fetchApi).mock.calls.map(([url]) => url)

afterEach(() => vi.mocked(fetchApi).mockClear())

// A tab of this bundle can follow a breakout move, so every pass it asks for says so.
describe('asking for a main-meeting pass', () => {
  it('marks the browser as one that follows a move', async () => {
    await fetchRoom({ roomId: 'abc', username: 'Ann B' })
    await fetchRoom({ roomId: 'abc' })
    await requestEntry({ roomId: 'abc', username: 'Ann' })
    const { result } = renderHook(() => useCreateRoom(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    })
    await act(() =>
      result.current.mutateAsync({ slug: 'abc', username: 'Ann' })
    )

    expect(requested()).toEqual([
      '/rooms/abc/?breakout=1&username=Ann%20B',
      '/rooms/abc/?breakout=1',
      '/rooms/abc/request-entry/?breakout=1',
      'rooms/?breakout=1&username=Ann',
    ])
  })
})
