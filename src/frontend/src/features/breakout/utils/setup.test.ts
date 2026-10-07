import { describe, expect, it } from 'vitest'
import { ParticipantKind, type Participant } from 'livekit-client'
import {
  buildRooms,
  defaultRoomCount,
  isAssignable,
  placeEvenly,
  restorePlan,
  shuffleAssignments,
} from './setup'
import { roomPalette } from '../components/roomPalette'

const participant = (
  overrides: Partial<Pick<Participant, 'isLocal' | 'kind' | 'attributes'>>
) =>
  ({
    isLocal: false,
    kind: ParticipantKind.STANDARD,
    attributes: { room_role: 'member' },
    ...overrides,
  }) as unknown as Participant

describe('isAssignable', () => {
  it('offers a room to a browser participant', () => {
    expect(isAssignable(participant({}))).toBe(true)
    expect(isAssignable(participant({ attributes: {} }))).toBe(true)
  })

  it('leaves out phone callers and agents, who cannot keep themselves to a room', () => {
    expect(isAssignable(participant({ kind: ParticipantKind.SIP }))).toBe(false)
    expect(isAssignable(participant({ kind: ParticipantKind.AGENT }))).toBe(
      false
    )
    expect(isAssignable(participant({ kind: ParticipantKind.EGRESS }))).toBe(
      false
    )
  })

  it('offers the hosts, this browser included', () => {
    expect(isAssignable(participant({ isLocal: true }))).toBe(true)
    expect(
      isAssignable(participant({ attributes: { room_role: 'owner' } }))
    ).toBe(true)
  })
})

describe('shuffleAssignments', () => {
  it('spreads everyone evenly over the rooms', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const assignments = shuffleAssignments(ids, 2)
    expect(Object.keys(assignments).sort()).toEqual(ids)
    const sizes = [0, 1].map(
      (room) => Object.values(assignments).filter((r) => r === room).length
    )
    expect(sizes.sort()).toEqual([2, 3])
  })

  it('draws the order from the random source', () => {
    expect(shuffleAssignments(['a', 'b', 'c'], 3, () => 0)).toEqual({
      b: 0,
      c: 1,
      a: 2,
    })
  })
})

describe('defaultRoomCount', () => {
  it('opens a room per 4 people, between 2 and 20', () => {
    expect(defaultRoomCount(0)).toBe(2)
    expect(defaultRoomCount(9)).toBe(3)
    expect(defaultRoomCount(16)).toBe(4)
    expect(defaultRoomCount(200)).toBe(20)
  })

  it('takes the count the host last opened first', () => {
    expect(defaultRoomCount(9, 7)).toBe(7)
    expect(defaultRoomCount(9, 30)).toBe(20)
    expect(defaultRoomCount(9, 'x' as unknown as number)).toBe(3)
  })
})

describe('restorePlan', () => {
  it('keeps the people still here, in the rooms that still exist', () => {
    const plan = { alice: 0, bob: 3, carol: 1, dave: -1, gone: 0 }
    expect(
      restorePlan(plan, ['alice', 'bob', 'carol', 'dave', 'new'], 3)
    ).toEqual({ alice: 0, carol: 1 })
  })

  it('restores nothing from a missing or broken plan', () => {
    expect(restorePlan(undefined, ['alice'], 2)).toEqual({})
    expect(
      restorePlan(
        { alice: '1' } as unknown as Record<string, number>,
        ['alice'],
        2
      )
    ).toEqual({})
  })
})

describe('placeEvenly', () => {
  it('fills the emptiest room first and moves nobody already placed', () => {
    const assignments = { a: 0, b: 0, c: 1 }
    expect(placeEvenly(['a', 'b', 'c', 'd', 'e', 'f'], assignments, 3)).toEqual(
      { a: 0, b: 0, c: 1, d: 2, e: 1, f: 2 }
    )
  })

  it('treats a room past the count as no room', () => {
    expect(placeEvenly(['a', 'b'], { a: 5, b: 0 }, 2)).toEqual({ a: 1, b: 0 })
  })

  it('counts a host placed by hand, and leaves the host there', () => {
    expect(placeEvenly(['a', 'b'], { host: 0 }, 2)).toEqual({
      host: 0,
      a: 1,
      b: 0,
    })
  })
})

describe('roomPalette', () => {
  it('gives the first ten rooms ten colours, then comes round again', () => {
    const colours = Array.from({ length: 10 }, (_, i) => roomPalette(i))
    expect(new Set(colours).size).toBe(10)
    expect(roomPalette(10)).toBe(roomPalette(0))
    expect(roomPalette(19)).toBe(roomPalette(9))
  })
})

describe('buildRooms', () => {
  it('puts each present person in their room and drops the others', () => {
    const people = [
      { identity: 'alice', name: 'Alice', isHost: true },
      { identity: 'bob', name: 'Bob' },
      { identity: 'carol', name: 'Carol' },
    ]
    const assignments = { alice: 1, bob: 0, carol: 2, dave: 0 }
    expect(buildRooms(['Room 1', 'Room 2'], people, assignments)).toEqual([
      { name: 'Room 1', participants: [{ identity: 'bob', name: 'Bob' }] },
      { name: 'Room 2', participants: [{ identity: 'alice', name: 'Alice' }] },
    ])
  })
})
