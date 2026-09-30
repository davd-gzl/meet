import { describe, expect, it } from 'vitest'
import { ConnectionState } from 'livekit-client'
import { leaveCurrentRoom } from './roomLifecycle'

const MAIN = 'main-meeting'
const BREAKOUT = 'breakout_s_0'

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// livekit-client's Room reduced to what decides a move: connect() ignores the
// token when already connected, and disconnect() lands once the gate opens.
class FakeRoom {
  state = ConnectionState.Disconnected
  name: string | null = null
  log: string[] = []
  disconnectCalls = 0
  gate = deferred()

  constructor(joined?: string) {
    if (joined) {
      this.state = ConnectionState.Connected
      this.name = joined
    }
    this.gate.resolve()
  }

  holdDisconnect() {
    this.gate = deferred()
    return this.gate
  }

  connect = async (token: string) => {
    if (this.state === ConnectionState.Connected) {
      this.log.push(`already connected to room ${this.name}`)
      return
    }
    this.state = ConnectionState.Connected
    this.name = token
  }

  disconnect = async () => {
    if (this.state === ConnectionState.Disconnected) return
    this.disconnectCalls += 1
    await this.gate.promise
    this.state = ConnectionState.Disconnected
    this.name = null
  }
}

// What <LiveKitRoom> does on a key change: disconnect fire-and-forget, then connect.
const remountWithToken = (room: FakeRoom, token: string) => {
  void room.disconnect()
  return room.connect(token)
}

describe('leaveCurrentRoom', () => {
  it('waits for the disconnect, so the next connect uses the new token', async () => {
    const room = new FakeRoom(MAIN)
    room.holdDisconnect()

    const left = leaveCurrentRoom(room)
    expect(room.state).toBe('connected')
    room.gate.resolve()
    await left
    expect(room.disconnectCalls).toBe(1)

    await remountWithToken(room, BREAKOUT)

    expect(room.name).toBe(BREAKOUT)
    expect(room.log).toEqual([])
  })

  it('disconnects nothing for a participant outside a room', async () => {
    const room = new FakeRoom()

    await leaveCurrentRoom(room)
    await expect(leaveCurrentRoom(null)).resolves.toBeUndefined()
    expect(room.disconnectCalls).toBe(0)
  })

  it('surfaces a failed disconnect instead of reporting a move', async () => {
    const room = new FakeRoom(MAIN)
    const gate = room.holdDisconnect()
    const left = leaveCurrentRoom(room)
    gate.reject(new Error('leave_failed'))

    await expect(left).rejects.toThrow('leave_failed')
    expect(room.state).toBe('connected')
    expect(room.name).toBe(MAIN)
  })
})
