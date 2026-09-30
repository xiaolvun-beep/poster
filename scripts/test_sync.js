const assert = require('assert')

const storePath = require.resolve('../services/store')
const apiPath = require.resolve('../services/api')
let queue = []
let calls = 0
let failNext = false

require.cache[storePath] = {
  id: storePath, filename: storePath, loaded: true,
  exports: {
    pending: () => queue,
    dequeue: id => { queue = queue.filter(item => item.id !== id) },
    pruneChunks() {}
  }
}
require.cache[apiPath] = {
  id: apiPath, filename: apiPath, loaded: true,
  exports: {
    enabled: () => true,
    async call(action) {
      assert.strictEqual(action, 'putSession')
      calls++
      if (failNext) { failNext = false; throw new Error('offline') }
    }
  }
}

const sync = require('../services/sync')
async function main() {
  await sync.flush()
  queue.push({ id: 'start_work_1', kind: 'session', session: { id: 'work_1' } })
  await sync.flush()
  assert.strictEqual(queue.length, 0, 'a new item must sync after an empty startup queue')

  queue.push({ id: 'start_work_2', kind: 'session', session: { id: 'work_2' } })
  failNext = true
  const originalWarn = console.warn
  console.warn = () => {}
  try { await sync.flush() } finally { console.warn = originalWarn }
  assert.strictEqual(queue.length, 1, 'a failed item must stay queued')
  await sync.flush()
  assert.strictEqual(queue.length, 0, 'the failed item must sync on retry')
  assert.strictEqual(calls, 3)
  console.log('Empty startup queue and failed-upload retry OK')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
