const store = require('./store')
const api = require('./api')
let inFlight = null
function flush() {
  if (!api.enabled()) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = Promise.resolve().then(async () => {
    try {
      const attempted = new Set()
      while (store.pending().length) {
        const item = store.pending()[0]
        if (attempted.has(item.id)) break
        if (item.kind === 'chunk') {
          const chunk = store.getChunk(item.id)
          if (chunk) {
            try { await api.call('putChunk', { chunk }) }
            catch (error) {
              if (!/工作记录已删除/.test(error.message || '')) throw error
              store.deleteRecord(chunk.sessionId)
              continue
            }
            store.markChunkSynced(item.id)
          }
          store.dequeue(item.id)
        } else if (item.kind === 'session') {
          try { await api.call('putSession', { session: item.session }) }
          catch (error) {
            if (!/工作记录已删除/.test(error.message || '')) throw error
            store.deleteRecord(item.session.id)
            continue
          }
          store.dequeue(item.id)
        } else if (item.kind === 'boss') {
          await api.call('putBoss', { boss: item.boss })
          store.dequeue(item.id)
        } else if (item.kind === 'delete') {
          const result = await api.call('deleteSession', { id: item.recordId })
          store.dequeue(item.id)
          if (result.cleanupPending) { store.enqueue(item); attempted.add(item.id) }
        } else {
          store.dequeue(item.id)
        }
      }
      store.pruneChunks()
    } catch (error) { console.warn('云同步稍后重试', error) }
  }).finally(() => { inFlight = null })
  return inFlight
}
module.exports = { flush }
