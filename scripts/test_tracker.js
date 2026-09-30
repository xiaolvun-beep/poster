const assert = require('assert')
const memory = new Map()
let now = 1000
let location = { latitude: 30, longitude: 120, accuracy: 10 }
let listener
let errorListener
let backgroundAvailable = false
let backgroundAuthorized = true
let backgroundStarts = 0
let backgroundAuthorizations = 0
let nextTimer = 0
const timers = new Map()
const originalNow = Date.now
const originalSetTimeout = global.setTimeout
const originalClearTimeout = global.clearTimeout
Date.now = () => now
global.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id }
global.clearTimeout = id => { timers.delete(id) }
global.wx = {
  getStorageSync(key) { return memory.get(key) },
  setStorageSync(key, value) { memory.set(key, JSON.parse(JSON.stringify(value))) },
  removeStorageSync(key) { memory.delete(key) },
  getStorageInfoSync() { return { keys: [...memory.keys()], currentSize: 1 } },
  onLocationChange(fn) { listener = fn },
  onLocationChangeError(fn) { errorListener = fn },
  authorize({ scope, success, fail }) { assert.strictEqual(scope, 'scope.userLocationBackground'); backgroundAuthorizations++; if (backgroundAuthorized) success(); else fail({ errMsg: '后台位置授权被拒绝' }) },
  startLocationUpdateBackground({ success, fail }) { backgroundStarts++; if (backgroundAvailable && backgroundAuthorized) success(); else fail({ errMsg: backgroundAvailable ? '后台位置授权被拒绝' : '后台定位未开通' }) },
  startLocationUpdate({ success }) { success() },
  stopLocationUpdate({ success }) { if (success) success() },
  getLocation({ success }) { success(location) }
}
const tracker = require('../services/tracker')
async function main() {
  location = { latitude: 30, longitude: 120, accuracy: 150 }
  await assert.rejects(tracker.start(), /精度不足/)
  assert.strictEqual(tracker.snapshot().session, null)
  location = { latitude: 30, longitude: 120, accuracy: 10 }
  await tracker.start()
  assert.strictEqual(backgroundAuthorizations, 1)
  assert.strictEqual(tracker.snapshot().trackingMode, 'foreground')
  assert(tracker.snapshot().backgroundError.includes('后台定位未开通'))
  assert(tracker.snapshot().trackingError.includes('仅前台定位'))
  const sessionId = tracker.snapshot().session.id
  assert.strictEqual(tracker.snapshot().session.pointCount, 1)
  now = 31000
  location = { latitude: 30.0002, longitude: 120, accuracy: 10 }
  listener(location)
  tracker.pause()
  now = 61000
  location = { latitude: 30.0004, longitude: 120, accuracy: 10 }
  await tracker.resume()
  assert.strictEqual(backgroundAuthorizations, 2)
  assert.strictEqual(tracker.snapshot().session.buffer[0].breakBefore, true)
  now = 91000
  const record = tracker.finish()
  assert.strictEqual(record.pausedMs, 30000)
  assert.strictEqual(record.durationMs, 60000)
  assert.strictEqual(record.status, 'pending')
  assert.strictEqual(memory.get('poster.records.v1')[0].id, sessionId)
  assert(memory.get('poster.pending.v1').some(x => x.id === `finish_${sessionId}`))
  const store = require('../services/store')
  const savedTrack = store.getLocalTrack(sessionId)
  assert.strictEqual(savedTrack.length, 3)
  assert.deepStrictEqual([savedTrack[0].latitude, savedTrack[0].longitude], [30, 120])
  assert.strictEqual(savedTrack[2].breakBefore, true)
  const records = require('../services/records')
  assert.strictEqual((await records.track(sessionId)).length, 3)
  store.deleteRecord(sessionId)
  assert.strictEqual(store.getRecords().length, 0)
  assert(!store.pending().some(item => item.kind === 'session' && item.session.id === sessionId))
  assert.strictEqual(store.getLocalTrack(sessionId).length, 0)
  now = 120000
  location = { latitude: 30.001, longitude: 120, accuracy: 10 }
  await tracker.start()
  assert.strictEqual(backgroundAuthorizations, 3)
  const simpleId = tracker.snapshot().session.id
  now = 150000
  listener({ latitude: 30.0012, longitude: 120, accuracy: 10 })
  const simpleRecord = tracker.finish()
  assert.strictEqual(simpleRecord.pointCount, 2)
  assert.strictEqual((await records.track(simpleId)).length, 2)
  store.deleteRecord(simpleId)
  backgroundAvailable = true
  now = 180000
  location = { latitude: 30.002, longitude: 120, accuracy: 10 }
  await tracker.start()
  assert.strictEqual(backgroundAuthorizations, 4)
  assert.strictEqual(tracker.snapshot().trackingMode, 'background')
  const recoveredId = tracker.snapshot().session.id
  now = 181000
  errorListener({ errMsg: '定位服务暂时中断' })
  assert.strictEqual(tracker.snapshot().session.gapCount, 1)
  assert.strictEqual(tracker.snapshot().session.lastPoint, null)
  assert.strictEqual(timers.size, 1)
  const startsBeforeRetry = backgroundStarts
  const retry = [...timers.entries()][0]
  assert.strictEqual(retry[1].delay, 5000)
  timers.delete(retry[0])
  now = 186000
  location = { latitude: 30.003, longitude: 120, accuracy: 10 }
  retry[1].fn()
  await Promise.resolve()
  assert(backgroundStarts > startsBeforeRetry)
  assert.strictEqual(tracker.snapshot().session.pointCount, 2)
  assert.strictEqual(tracker.snapshot().session.buffer[1].breakBefore, true)
  assert.strictEqual(timers.size, 0)
  now = 260000
  location = { latitude: 30.004, longitude: 120, accuracy: 10 }
  const startsBeforeRecover = backgroundStarts
  tracker.recover()
  await Promise.resolve()
  assert(backgroundStarts > startsBeforeRecover)
  assert.strictEqual(tracker.snapshot().session.gapCount, 2)
  assert.strictEqual(tracker.snapshot().session.buffer[2].breakBefore, true)
  now = 500000
  listener({ latitude: 30.05, longitude: 120, accuracy: 10 })
  assert.strictEqual(tracker.snapshot().session.pointCount, 4)
  assert.strictEqual(tracker.snapshot().session.gapCount, 3)
  assert.strictEqual(tracker.snapshot().session.buffer[3].breakBefore, true)
  assert.strictEqual(tracker.snapshot().session.distanceMeters, 0)
  const recoveredRecord = tracker.finish()
  assert.strictEqual(recoveredRecord.id, recoveredId)
  assert.strictEqual(recoveredRecord.durationMs, 320000)
  assert.strictEqual(timers.size, 0)
  backgroundAuthorized = false
  now = 600000
  location = { latitude: 30.06, longitude: 120, accuracy: 10 }
  await tracker.start()
  assert.strictEqual(tracker.snapshot().trackingMode, 'foreground')
  assert.strictEqual(tracker.snapshot().backgroundPermissionDenied, true)
  backgroundAuthorized = true
  await tracker.retryBackground()
  assert.strictEqual(tracker.snapshot().trackingMode, 'background')
  assert.strictEqual(tracker.snapshot().backgroundPermissionDenied, false)
  tracker.finish()
  store.saveRecord({ id: 'work_local_a', startAt: 1, amountCents: 4000, status: 'settled', settlementId: 'settle_local' })
  store.saveRecord({ id: 'work_local_b', startAt: 2, amountCents: 4600, status: 'settled', settlementId: 'settle_local' })
  store.saveSettlement({ id: 'settle_local', sessionIds: ['work_local_a', 'work_local_b'], amountCents: 8600, createdAt: 3 })
  store.deleteRecord('work_local_a')
  assert.strictEqual(store.getSettlements()[0].amountCents, 4600)
  assert.deepStrictEqual(store.getSettlements()[0].sessionIds, ['work_local_b'])
  store.deleteRecord('work_local_b')
  assert.strictEqual(store.getSettlements().length, 0)
  console.log('Foreground fallback, pause and lock-screen recovery, pay clock and local record deletion OK')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { Date.now = originalNow; global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout })
