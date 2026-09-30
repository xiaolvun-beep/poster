const fs = require('fs')
const path = require('path')
const assert = require('assert')
const root = path.resolve(__dirname, '..')
const app = require('../app.json')
const tracker = require('../services/tracker')
const format = require('../utils/format')
const geo = require('../utils/geo')

assert.strictEqual(app.tabBar.list.length, 4)
for (const page of app.pages) {
  for (const ext of ['js', 'json', 'wxml', 'wxss']) assert(fs.existsSync(path.join(root, `${page}.${ext}`)), `${page}.${ext} missing`)
}
const working = { startAt: 0, pausedMs: 60000, pausedAt: null, rateCents: 3600 }
assert.strictEqual(tracker.durationAt(working, 3600000), 3540000)
assert.strictEqual(tracker.amountAt(working, 3600000), 3540)
assert.strictEqual(tracker.durationAt({ startAt: 0, pausedMs: 0, pausedAt: 1800000 }, 3600000), 1800000)
assert.strictEqual(format.money(3540), '35.40')
assert(geo.meters({ latitude: 30, longitude: 120 }, { latitude: 30.001, longitude: 120 }) > 100)
console.log('Project, clock and amount checks OK')
