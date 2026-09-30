const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const sessions = db.collection('sessions')
const chunks = db.collection('track_chunks')
const bosses = db.collection('bosses')
const settlements = db.collection('settlements')

function fail(message) { throw new Error(message) }
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(id) }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) }
function owned(doc, owner) { if (!doc || doc.owner !== owner) fail('无权访问该数据') }
async function docOrNull(collection, id) {
  try { return (await collection.doc(id).get()).data } catch (error) {
    if (error.errCode === -1 || /not exist|不存在/i.test(error.errMsg || error.message || '')) return null
    throw error
  }
}
function cleanSession(input) {
  if (!input || !validId(input.id) || !finite(input.startAt) || !finite(input.rateCents) || input.rateCents < 1) fail('工作数据无效')
  if (!['active', 'pending'].includes(input.status)) fail('工作状态无效')
  if (input.status === 'pending' && (!finite(input.endAt) || input.endAt < input.startAt)) fail('结束时间无效')
  const durationMs = Math.max(0, Math.round(input.durationMs || 0))
  const pausedMs = Math.max(0, Math.round(input.pausedMs || 0))
  if (input.status === 'pending' && durationMs !== Math.max(0, input.endAt - input.startAt - pausedMs)) fail('工作时长与起止时间不一致')
  const amountCents = input.status === 'pending' ? Math.round(input.rateCents * durationMs / 3600000) : 0
  if (amountCents !== input.amountCents) fail('工作金额校验失败')
  return {
    id: input.id, startAt: input.startAt, endAt: input.endAt || null,
    durationMs, pausedMs, rateCents: Math.round(input.rateCents), amountCents,
    distanceMeters: Math.max(0, Math.round(input.distanceMeters || 0)),
    pointCount: Math.max(0, Math.round(input.pointCount || 0)), gapCount: Math.max(0, Math.round(input.gapCount || 0)),
    bossId: input.bossId || '', bossName: String(input.bossName || '未指定老板').slice(0, 40),
    status: input.status, settlementId: null, settledAt: null
  }
}
async function putSession(event, owner) {
  const data = cleanSession(event.session)
  const old = await docOrNull(sessions, data.id)
  if (old) {
    owned(old, owner)
    if (old.status === 'deleted') fail('工作记录已删除')
    if (old.status === 'settled' || (old.status === 'pending' && data.status === 'active')) return old
    if (old.status === 'pending' && data.status === 'pending') {
      if (old.amountCents !== data.amountCents || old.endAt !== data.endAt) fail('工作记录已存在且内容不同')
      return old
    }
  }
  const record = Object.assign({}, data, { owner, createdAt: old ? old.createdAt : Date.now() })
  await sessions.doc(data.id).set({ data: record })
  return record
}
async function putChunk(event, owner) {
  const input = event.chunk
  if (!input || !validId(input.id) || !validId(input.sessionId) || input.id.indexOf(input.sessionId + '_') !== 0 || !Array.isArray(input.points) || !input.points.length || input.points.length > 30) fail('轨迹批次无效')
  const points = input.points.map((p, i) => {
    if (!finite(p.latitude) || !finite(p.longitude) || !finite(p.at) || !finite(p.seq) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || (i && p.seq !== input.points[i - 1].seq + 1)) fail('轨迹点无效')
    return { latitude: p.latitude, longitude: p.longitude, at: p.at, seq: p.seq, accuracy: finite(p.accuracy) ? p.accuracy : 0, breakBefore: !!p.breakBefore }
  })
  if (points[0].seq !== input.firstSeq || points[points.length - 1].seq !== input.lastSeq) fail('轨迹序号无效')
  const session = await docOrNull(sessions, input.sessionId)
  if (session) { owned(session, owner); if (session.status === 'deleted') fail('工作记录已删除') }
  const old = await docOrNull(chunks, input.id)
  if (old) {
    owned(old, owner)
    if (old.sessionId !== input.sessionId || old.firstSeq !== input.firstSeq || old.lastSeq !== input.lastSeq || JSON.stringify(old.points) !== JSON.stringify(points)) fail('轨迹批次编号冲突')
    return { id: input.id }
  }
  await chunks.doc(input.id).set({ data: { owner, sessionId: input.sessionId, firstSeq: input.firstSeq, lastSeq: input.lastSeq, points, createdAt: Date.now() } })
  return { id: input.id }
}
async function listSessions(event, owner) {
  const offset = Math.max(0, Math.floor(event.offset || 0))
  const result = await sessions.where({ owner, status: _.in(['pending', 'settled']) }).orderBy('startAt', 'desc').skip(offset).limit(100).get()
  return { items: result.data, nextOffset: result.data.length === 100 ? offset + 100 : null }
}
async function getSession(event, owner) {
  if (!validId(event.id)) fail('记录编号无效')
  const record = await docOrNull(sessions, event.id)
  owned(record, owner)
  if (record.status === 'deleted') fail('工作记录已删除')
  return record
}
async function deleteSession(event, owner) {
  if (!validId(event.id)) fail('记录编号无效')
  const result = await db.runTransaction(async transaction => {
    const record = await docOrNull(transaction.collection('sessions'), event.id)
    if (!record) return { id: event.id, deleted: false, settlementId: null, settlement: null }
    owned(record, owner)
    if (record.status === 'deleted') return { id: event.id, deleted: false, settlementId: null, settlement: null }
    if (record.status !== 'pending' && record.status !== 'settled') fail('只能删除已结束的工作')
    const response = { id: event.id, deleted: true, settlementId: record.settlementId || null, settlement: null }
    if (record.settlementId) {
      const settlement = await docOrNull(transaction.collection('settlements'), record.settlementId)
      owned(settlement, owner)
      if (!settlement.sessionIds.includes(event.id)) fail('结算记录与工作记录不一致')
      const sessionIds = settlement.sessionIds.filter(id => id !== event.id)
      const amountCents = settlement.amountCents - record.amountCents
      if (amountCents < 0) fail('结算金额异常')
      if (sessionIds.length) {
        await transaction.collection('settlements').doc(settlement.id).update({ data: { sessionIds, amountCents } })
        response.settlement = Object.assign({}, settlement, { sessionIds, amountCents })
      } else {
        await transaction.collection('settlements').doc(settlement.id).remove()
      }
    }
    await transaction.collection('sessions').doc(event.id).set({ data: { id: event.id, owner, status: 'deleted', deletedAt: Date.now() } })
    return response
  })
  try {
    for (let batch = 0; batch < 100; batch++) {
      const page = await chunks.where({ owner, sessionId: event.id }).limit(100).get()
      if (!page.data.length) break
      await Promise.all(page.data.map(chunk => chunks.doc(chunk._id).remove()))
    }
  } catch (error) {
    console.error('轨迹批次清理待重试', error)
    result.cleanupPending = true
  }
  return result
}
async function listChunks(event, owner) {
  if (!validId(event.sessionId)) fail('记录编号无效')
  const record = await docOrNull(sessions, event.sessionId)
  owned(record, owner)
  if (record.status === 'deleted') fail('工作记录已删除')
  const offset = Math.max(0, Math.floor(event.offset || 0))
  const result = await chunks.where({ owner, sessionId: event.sessionId }).orderBy('firstSeq', 'asc').skip(offset).limit(30).get()
  return { items: result.data, nextOffset: result.data.length === 30 ? offset + 30 : null }
}
async function putBoss(event, owner) {
  const input = event.boss
  if (!input || !validId(input.id) || !String(input.name || '').trim()) fail('老板资料无效')
  const old = await docOrNull(bosses, input.id)
  if (old) owned(old, owner)
  const record = { id: input.id, owner, name: String(input.name).trim().slice(0, 30), createdAt: old ? old.createdAt : Date.now() }
  await bosses.doc(input.id).set({ data: record })
  return record
}
async function listBosses(owner) { return (await bosses.where({ owner }).limit(100).get()).data }
async function settle(event, owner) {
  const ids = event.sessionIds
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length || !ids.every(validId)) fail('每次请选择 1 至 20 条不重复的工作记录')
  if (!validId(event.requestId) || !Number.isInteger(event.expectedCents) || event.expectedCents < 0) fail('结算请求无效')
  const existing = await docOrNull(settlements, event.requestId)
  if (existing) { owned(existing, owner); return existing }
  return db.runTransaction(async transaction => {
    const records = []
    for (const id of ids) {
      const result = await transaction.collection('sessions').doc(id).get()
      const record = result.data
      owned(record, owner)
      if (record.status !== 'pending' || record.bossId !== (event.bossId || '')) fail('工作记录已结算或老板不一致，请刷新')
      records.push(record)
    }
    const amountCents = records.reduce((sum, x) => sum + x.amountCents, 0)
    if (amountCents !== event.expectedCents) fail('实收金额与应收金额不一致，请刷新')
    const now = Date.now()
    const result = { id: event.requestId, owner, bossId: event.bossId || '', bossName: records[0].bossName, sessionIds: ids, amountCents, createdAt: now }
    await transaction.collection('settlements').doc(result.id).set({ data: result })
    for (const record of records) {
      await transaction.collection('sessions').doc(record.id).update({ data: { status: 'settled', settlementId: result.id, settledAt: now } })
    }
    return result
  })
}
async function listSettlements(event, owner) {
  const offset = Math.max(0, Math.floor(event.offset || 0))
  const result = await settlements.where({ owner }).orderBy('createdAt', 'desc').skip(offset).limit(100).get()
  return { items: result.data, nextOffset: result.data.length === 100 ? offset + 100 : null }
}
async function getSettlement(event, owner) {
  if (!validId(event.id)) fail('结算编号无效')
  const record = await docOrNull(settlements, event.id)
  owned(record, owner)
  const work = []
  for (const id of record.sessionIds) {
    const item = await docOrNull(sessions, id)
    owned(item, owner)
    work.push(item)
  }
  return { settlement: record, sessions: work }
}
exports.main = async (event) => {
  try {
    const owner = cloud.getWXContext().OPENID
    if (!owner) fail('无法确认微信身份')
    let data
    switch (event.action) {
      case 'putSession': data = await putSession(event, owner); break
      case 'putChunk': data = await putChunk(event, owner); break
      case 'listSessions': data = await listSessions(event, owner); break
      case 'getSession': data = await getSession(event, owner); break
      case 'deleteSession': data = await deleteSession(event, owner); break
      case 'listChunks': data = await listChunks(event, owner); break
      case 'putBoss': data = await putBoss(event, owner); break
      case 'listBosses': data = await listBosses(owner); break
      case 'settle': data = await settle(event, owner); break
      case 'listSettlements': data = await listSettlements(event, owner); break
      case 'getSettlement': data = await getSettlement(event, owner); break
      default: fail('未知操作')
    }
    return { ok: true, data }
  } catch (error) { return { ok: false, error: error.message || '操作失败' } }
}
