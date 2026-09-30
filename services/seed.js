const store = require('./store')

const SEED_ID = 'work_1790420400000_manual1'

function seedMockRecord() {
  if (store.getRecords().some(x => x.id === SEED_ID)) return
  const startAt = 1790420400000
  const record = {
    id: SEED_ID, startAt, endAt: startAt + 3600000, durationMs: 3600000, pausedMs: 0,
    rateCents: 2000, amountCents: 2000, distanceMeters: 0, pointCount: 0, gapCount: 0,
    bossId: '', bossName: '未指定老板', status: 'pending', settlementId: null, settledAt: null
  }
  store.saveRecord(record)
  store.enqueue({ id: `finish_${SEED_ID}`, kind: 'session', session: record })
}

module.exports = { seedMockRecord }