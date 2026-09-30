const assert = require('assert')

global.Component = () => {}
const { buildMapData } = require('../components/track-map/track-map')

const empty = buildMapData([], true)
assert.strictEqual(empty.hasPoints, false)

const points = [
  { latitude: 30, longitude: 120 },
  { latitude: 30.0002, longitude: 120 },
  { latitude: 30.0004, longitude: 120, breakBefore: true },
  { latitude: 30.0006, longitude: 120 }
]
const live = buildMapData(points, true)
assert.strictEqual(live.hasPoints, true)
assert.deepStrictEqual([live.latitude, live.longitude], [30.0006, 120])
assert.strictEqual(live.polylines.length, 2)
assert(live.polylines.every(line => line.color === '#2D7FF9' && line.width === 4 && !('borderColor' in line) && !('borderWidth' in line)))
assert.strictEqual(live.circles.length, 2)
assert(live.circles.every(circle => circle.radius === 4 && circle.strokeWidth === 1))
assert.deepStrictEqual(live.circles.map(circle => circle.fillColor), ['#22C55E', '#EF4444'])
assert.strictEqual(live.scale, 17)
assert.strictEqual(buildMapData(points, false).scale, 15)
console.log('Live position, saved track and pause gap map segments OK')
