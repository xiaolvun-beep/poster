const assert = require('assert')
const Module = require('module')
const collections = { sessions: new Map(), track_chunks: new Map(), bosses: new Map(), settlements: new Map() }
let owner = 'owner-a'
function clone(value) { return JSON.parse(JSON.stringify(value)) }
function adapter(tables) {
  return {
    collection(name) {
      const table = tables[name]
      return {
        doc(id) {
          return {
            async get() { if (!table.has(id)) throw Object.assign(new Error('not exist'), { errCode: -1 }); return { data: clone(table.get(id)) } },
            async set({ data }) {
              if (Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('document.set cannot update _id')
              table.set(id, Object.assign({ _id: id }, clone(data)))
              return {}
            },
            async update({ data }) { table.set(id, Object.assign({}, table.get(id), clone(data))); return {} },
            async remove() { table.delete(id); return {} }
          }
        },
        where(query) {
          let rows = [...table.values()].filter(item => Object.entries(query).every(([key, value]) => value && value.values ? value.values.includes(item[key]) : item[key] === value))
          return {
            orderBy(key, direction) { rows.sort((a, b) => direction === 'desc' ? b[key] - a[key] : a[key] - b[key]); return this },
            skip(n) { rows = rows.slice(n); return this },
            limit(n) { rows = rows.slice(0, n); return this },
            async get() { return { data: clone(rows) } }
          }
        }
      }
    }
  }
}
const cloud = {
  DYNAMIC_CURRENT_ENV: 'test', init() {}, getWXContext() { return { OPENID: owner } },
  database() {
    return Object.assign(adapter(collections), {
      command: { in(values) { return { values } } },
      async runTransaction(fn) {
        const copy = Object.fromEntries(Object.entries(collections).map(([name, table]) => [name, new Map([...table].map(([id, value]) => [id, clone(value)]))]))
        const result = await fn(adapter(copy))
        Object.keys(collections).forEach(name => { collections[name].clear(); copy[name].forEach((value, key) => collections[name].set(key, value)) })
        return result
      }
    })
  }
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) { return request === 'wx-server-sdk' ? cloud : originalLoad.call(this, request, parent, isMain) }
const ledger = require('../cloudfunctions/ledger/index')
Module._load = originalLoad
async function call(action, payload) {
  const result = await ledger.main(Object.assign({ action }, payload))
  if (!result.ok) throw new Error(result.error)
  return result.data
}
async function main() {
  const ids = []
  for (let i = 0; i < 8; i++) {
    const id = `work_test_${i}`; ids.push(id)
    await call('putSession', { session: {
      id, startAt: 1000 + i, endAt: 3601000 + i, durationMs: 3600000, pausedMs: 0,
      rateCents: i === 7 ? 4600 : 4000, amountCents: i === 7 ? 4600 : 4000,
      distanceMeters: 1000, pointCount: 20, gapCount: 0,
      bossId: 'boss_test', bossName: '测试老板', status: 'pending'
    } })
  }
  const chunk = { id: 'work_test_0_1', sessionId: 'work_test_0', firstSeq: 1, lastSeq: 2, points: [
    { seq: 1, latitude: 30, longitude: 120, at: 1000, accuracy: 10 },
    { seq: 2, latitude: 30.001, longitude: 120, at: 2000, accuracy: 10, breakBefore: true }
  ] }
  await call('putChunk', { chunk })
  await call('putChunk', { chunk })
  await assert.rejects(() => call('putChunk', { chunk: Object.assign({}, chunk, { points: [chunk.points[0], Object.assign({}, chunk.points[1], { latitude: 31 })] }) }))
  const settlement = await call('settle', { requestId: 'settle_test', bossId: 'boss_test', sessionIds: ids, expectedCents: 32600 })
  assert.strictEqual(settlement.amountCents, 32600)
  assert.strictEqual((await call('settle', { requestId: 'settle_test', bossId: 'boss_test', sessionIds: ids, expectedCents: 32600 })).id, settlement.id)
  const list = (await call('listSessions', { offset: 0 })).items
  assert.strictEqual(list.filter(x => x.status === 'settled').length, 8)
  assert.strictEqual(list.reduce((sum, x) => sum + x.amountCents, 0), 32600)
  const details = await call('getSettlement', { id: 'settle_test' })
  assert.strictEqual(details.sessions.length, 8)
  const deleted = await call('deleteSession', { id: ids[0] })
  assert.strictEqual(deleted.settlement.amountCents, 28600)
  assert.strictEqual(deleted.settlement.sessionIds.length, 7)
  assert.strictEqual((await call('listSessions', { offset: 0 })).items.reduce((sum, item) => sum + item.amountCents, 0), 28600)
  assert.strictEqual(collections.track_chunks.size, 0)
  await assert.rejects(() => call('getSession', { id: ids[0] }))
  await assert.rejects(() => call('putChunk', { chunk }))
  await assert.rejects(() => call('putSession', { session: { id: ids[0], startAt: 1000, endAt: 3601000, durationMs: 3600000, pausedMs: 0, rateCents: 4000, amountCents: 4000, status: 'pending' } }))
  owner = 'owner-b'
  await assert.rejects(() => call('getSettlement', { id: 'settle_test' }))
  await assert.rejects(() => call('deleteSession', { id: ids[1] }))
  owner = 'owner-a'
  for (const id of ids.slice(1)) await call('deleteSession', { id })
  await assert.rejects(() => call('getSettlement', { id: 'settle_test' }))
  await call('putSession', { session: { id: 'work_test_8', startAt: 9, endAt: 3600009, durationMs: 3600000, pausedMs: 0, rateCents: 1000, amountCents: 1000, distanceMeters: 0, pointCount: 0, gapCount: 0, bossId: 'boss_test', bossName: '测试老板', status: 'pending' } })
  await assert.rejects(() => call('settle', { requestId: 'settle_wrong', bossId: 'boss_test', sessionIds: ['work_test_8'], expectedCents: 999 }))
  assert.strictEqual((await call('getSession', { id: 'work_test_8' })).status, 'pending')
  await assert.rejects(() => call('putSession', { session: { id: 'work_bad_time', startAt: 0, endAt: 3600000, durationMs: 1800000, pausedMs: 0, rateCents: 1000, amountCents: 500, status: 'pending' } }))
  await call('deleteSession', { id: 'work_test_8' })
  assert.strictEqual((await call('listSessions', { offset: 0 })).items.length, 0)
  console.log('Atomic settlement, settled-record deletion, chunk cleanup and owner isolation OK')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
