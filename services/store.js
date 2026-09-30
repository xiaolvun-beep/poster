const ACTIVE = 'poster.active.v1'
const RECORDS = 'poster.records.v1'
const SETTINGS = 'poster.settings.v1'
const PENDING = 'poster.pending.v1'
const SETTLEMENTS = 'poster.settlements.v1'
const CHUNK_PREFIX = 'poster.chunk.'

function read(key, fallback) { try { return wx.getStorageSync(key) || fallback } catch (_) { return fallback } }
function write(key, value) { wx.setStorageSync(key, value) }
function getSettings() { return Object.assign({ hourlyRateCents: 2500, bosses: [], defaultBossId: '' }, read(SETTINGS, {})) }
function saveSettings(value) { write(SETTINGS, value) }
function getActive() { return read(ACTIVE, null) }
function saveActive(value) { if (value) write(ACTIVE, value); else wx.removeStorageSync(ACTIVE) }
function getRecords() { return read(RECORDS, []) }
function saveRecord(record) {
  const list = getRecords(); const index = list.findIndex(item => item.id === record.id)
  if (index >= 0) list[index] = record; else list.unshift(record)
  list.sort((a, b) => b.startAt - a.startAt); write(RECORDS, list)
}
function replaceRecords(remote) {
  const unsynced = new Set(pending().filter(item => item.kind === 'session' && item.session.status === 'pending').map(item => item.session.id))
  const byId = {}
  getRecords().filter(record => unsynced.has(record.id)).forEach(record => { byId[record.id] = record })
  remote.forEach(record => { byId[record.id] = record })
  write(RECORDS, Object.values(byId).sort((a, b) => b.startAt - a.startAt))
}
function getSettlements() { return read(SETTLEMENTS, []) }
function saveSettlement(item) {
  const list = getSettlements(); const index = list.findIndex(x => x.id === item.id)
  if (index >= 0) list[index] = item; else list.unshift(item)
  list.sort((a, b) => b.createdAt - a.createdAt); write(SETTLEMENTS, list)
}
function replaceSettlements(remote) { write(SETTLEMENTS, remote.slice().sort((a, b) => b.createdAt - a.createdAt)) }
function pending() { return read(PENDING, []) }
function enqueue(item) {
  const list = pending()
  if (!list.some(x => x.id === item.id)) { list.push(item); write(PENDING, list) }
}
function dequeue(id) { write(PENDING, pending().filter(x => x.id !== id)) }
function chunkKey(id) { return CHUNK_PREFIX + id }
function saveChunk(chunk) { write(chunkKey(chunk.id), chunk) }
function getChunk(id) { return read(chunkKey(id), null) }
function markChunkSynced(id) {
  const chunk = getChunk(id)
  if (chunk && !chunk.synced) { chunk.synced = true; saveChunk(chunk) }
}
function recoverChunkQueue() {
  const keys = wx.getStorageInfoSync().keys || []
  const queue = pending()
  const queued = new Set(queue.map(item => item.id))
  keys.filter(key => key.indexOf(CHUNK_PREFIX) === 0).forEach(key => {
    const chunk = read(key, null)
    if (chunk && !chunk.synced && !queued.has(chunk.id)) { queue.push({ id: chunk.id, kind: 'chunk' }); queued.add(chunk.id) }
  })
  if (queue.length !== pending().length) {
    queue.sort((a, b) => (a.kind === 'chunk' ? 0 : 1) - (b.kind === 'chunk' ? 0 : 1))
    write(PENDING, queue)
  }
}
function getLocalTrack(sessionId) {
  const keys = (wx.getStorageInfoSync().keys || []).filter(key => key.indexOf(CHUNK_PREFIX + sessionId + '_') === 0)
  return keys.map(key => read(key, null)).filter(Boolean).sort((a, b) => a.firstSeq - b.firstSeq).reduce((all, chunk) => all.concat(chunk.points), [])
}
function deleteRecord(id, cloudResult) {
  const current = getRecords()
  const record = current.find(item => item.id === id)
  const chunkPrefix = CHUNK_PREFIX + id + '_'
  write(PENDING, pending().filter(item => !(
    (item.kind === 'session' && item.session.id === id) ||
    (item.kind === 'chunk' && item.id.indexOf(id + '_') === 0)
  )))
  write(RECORDS, current.filter(item => item.id !== id))
  const settlementId = (cloudResult && cloudResult.settlementId) || (record && record.settlementId)
  if (settlementId) {
    let list = getSettlements().filter(item => item.id !== settlementId)
    if (cloudResult && cloudResult.deleted) {
      if (cloudResult.settlement) list.unshift(cloudResult.settlement)
    } else {
      const old = getSettlements().find(item => item.id === settlementId)
      if (old) {
        const sessionIds = old.sessionIds.filter(workId => workId !== id)
        if (sessionIds.length) {
          const amountCents = getRecords().filter(item => sessionIds.includes(item.id)).reduce((sum, item) => sum + item.amountCents, 0)
          list.unshift(Object.assign({}, old, { sessionIds, amountCents }))
        }
      }
    }
    replaceSettlements(list)
  }
  const keys = wx.getStorageInfoSync().keys || []
  keys.filter(key => key.indexOf(chunkPrefix) === 0).forEach(key => wx.removeStorageSync(key))
}
function pruneChunks() {
  const info = wx.getStorageInfoSync()
  if (info.currentSize < 7500) return
  const active = getActive()
  const keys = info.keys.filter(key => key.indexOf(CHUNK_PREFIX) === 0).sort()
  for (const key of keys) {
    if (wx.getStorageInfoSync().currentSize < 6000) break
    const chunk = read(key, null)
    if (chunk && chunk.synced && (!active || chunk.sessionId !== active.id)) wx.removeStorageSync(key)
  }
}
module.exports = { getSettings, saveSettings, getActive, saveActive, getRecords, saveRecord, replaceRecords, deleteRecord, getSettlements, saveSettlement, replaceSettlements, pending, enqueue, dequeue, saveChunk, getChunk, markChunkSynced, recoverChunkQueue, getLocalTrack, pruneChunks }
