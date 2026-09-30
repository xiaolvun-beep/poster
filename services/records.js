const api = require('./api')
const store = require('./store')
const sync = require('./sync')

async function refreshRecords() {
  if (!api.enabled()) return store.getRecords()
  await sync.flush()
  let offset = 0
  const all = []
  do {
    const page = await api.call('listSessions', { offset })
    all.push(...page.items)
    offset = page.nextOffset
  } while (offset !== null)
  store.replaceRecords(all)
  return store.getRecords()
}
async function refreshSettlements() {
  if (!api.enabled()) return store.getSettlements()
  let offset = 0
  const all = []
  do {
    const page = await api.call('listSettlements', { offset })
    all.push(...page.items)
    offset = page.nextOffset
  } while (offset !== null)
  store.replaceSettlements(all)
  return store.getSettlements()
}
async function deleteRecord(id) {
  if (!api.enabled()) { store.deleteRecord(id); return }
  await sync.flush()
  const queued = store.pending().some(item =>
    (item.kind === 'session' && item.session.id === id) ||
    (item.kind === 'chunk' && item.id.indexOf(id + '_') === 0)
  )
  if (queued) throw new Error('这条记录尚未上传，请联网后重试')
  const result = await api.call('deleteSession', { id })
  store.deleteRecord(id, result)
  if (result.cleanupPending) { store.enqueue({ id: `delete_${id}`, kind: 'delete', recordId: id }); sync.flush() }
}
async function track(sessionId) {
  const bySeq = {}
  store.getLocalTrack(sessionId).forEach(point => { bySeq[point.seq] = point })
  if (api.enabled()) {
    try {
      let offset = 0
      do {
        const page = await api.call('listChunks', { sessionId, offset })
        page.items.forEach(chunk => chunk.points.forEach(point => { bySeq[point.seq] = point }))
        offset = page.nextOffset
      } while (offset !== null)
    } catch (error) {
      console.warn('使用本机轨迹缓存', error)
      if (!Object.keys(bySeq).length) throw error
    }
  }
  return Object.values(bySeq).sort((a, b) => a.seq - b.seq)
}
module.exports = { refreshRecords, refreshSettlements, deleteRecord, track }
