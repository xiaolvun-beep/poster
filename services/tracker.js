const store = require('./store')
const sync = require('./sync')
const geo = require('../utils/geo')
const LOCATION_STALE_MS = 60000

let active = null
let listening = false
let trackingError = ''
let trackingMode = ''
let backgroundError = ''
let backgroundAuthError = ''
let lastSaveAt = 0
let startPromise = null
let retryTimer = null
let retryAttempts = 0
let recoveredQueue = false
const listeners = []
function emit() { listeners.forEach(fn => fn(snapshot())) }
function subscribe(fn) { listeners.push(fn); return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1) } }
function snapshot() {
  const stale = active && active.status === 'active' && (!active.lastPoint || Date.now() - active.lastPoint.at > LOCATION_STALE_MS)
  return {
    session: active, trackingMode,
    backgroundPermissionDenied: !!backgroundAuthError,
    backgroundError: [backgroundAuthError, backgroundError].filter(Boolean).join('；'),
    trackingError: trackingError || (stale ? '定位暂时中断，正在尝试恢复' : trackingMode === 'foreground' ? '仅前台定位，锁屏后轨迹会中断；请开启后台定位权限' : '')
  }
}
function requestBackgroundPermission() {
  if (!wx.authorize) return Promise.resolve()
  return new Promise(resolve => {
    try {
      wx.authorize({
        scope: 'scope.userLocationBackground',
        success() { backgroundAuthError = ''; resolve() },
        fail(error) { backgroundAuthError = (error && error.errMsg) || '未获得后台位置授权'; resolve() }
      })
    } catch (error) { backgroundAuthError = error.message || '无法请求后台位置授权'; resolve() }
  })
}
function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer)
  retryTimer = null
}
function scheduleRetry() {
  if (retryTimer !== null || !active || active.status !== 'active') return
  const delay = Math.min(60000, 5000 * Math.pow(2, Math.min(retryAttempts++, 4)))
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (active && active.status === 'active') startLocation().catch(scheduleRetry)
  }, delay)
}
function checkpoint() { if (active) { store.saveActive(active); lastSaveAt = Date.now() } }
function durationAt(session, at) {
  if (!session) return 0
  return Math.max(0, (session.pausedAt || at) - session.startAt - session.pausedMs)
}
function amountAt(session, at) { return Math.round(session.rateCents * durationAt(session, at) / 3600000) }
function sealBuffer() {
  if (!active || !active.buffer.length) return
  const points = active.buffer
  const firstSeq = points[0].seq
  const id = `${active.id}_${firstSeq}`
  store.saveChunk({ id, sessionId: active.id, firstSeq, lastSeq: points[points.length - 1].seq, points })
  store.enqueue({ id, kind: 'chunk' })
  active.buffer = []
  checkpoint()
  sync.flush()
}
function onLocation(location) {
  if (!active || active.status !== 'active') return
  const latitude = Number(location.latitude); const longitude = Number(location.longitude)
  const accuracy = Number(location.accuracy || 0)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return
  if (accuracy > 100) return
  const now = Date.now()
  const point = { seq: active.nextSeq++, latitude, longitude, accuracy, at: now }
  const gap = active.lastPoint && now - active.lastPoint.at > LOCATION_STALE_MS
  if (active.segmentBreak || gap) point.breakBefore = true
  if (gap && !active.segmentBreak) active.gapCount++
  if (active.lastPoint && !point.breakBefore) {
    const delta = geo.meters(active.lastPoint, point)
    const seconds = Math.max(1, (now - active.lastPoint.at) / 1000)
    if (delta < 5 && seconds < 15) { active.nextSeq--; return }
    if (delta > 100 && delta / seconds > 12) { active.nextSeq--; return }
    if (delta >= 5) active.distanceMeters += delta
  }
  clearRetry(); retryAttempts = 0
  trackingError = ''
  active.lastPoint = point
  active.segmentBreak = false
  active.buffer.push(point)
  active.pointCount++
  if (active.buffer.length >= 20) sealBuffer()
  else if (now - lastSaveAt >= 5000) checkpoint()
  emit()
}
function register() {
  if (listening) return
  wx.onLocationChange(onLocation)
  if (wx.onLocationChangeError) wx.onLocationChangeError(error => {
    if (!active || active.status !== 'active') return
    trackingError = (error && error.errMsg) || '定位已中断，正在重试'
    if (!active.segmentBreak && active.lastPoint) {
      active.gapCount++
      active.segmentBreak = true
      active.lastPoint = null
      checkpoint()
    }
    scheduleRetry()
    emit()
  })
  listening = true
}
function startLocation() {
  if (startPromise) return startPromise
  register()
  startPromise = new Promise((resolve, reject) => {
    const started = mode => {
      trackingMode = mode
      if (mode === 'background') { backgroundError = ''; backgroundAuthError = '' }
      if (!active) trackingError = ''
      wx.getLocation({ type: 'gcj02', success: onLocation, fail() {} })
      if (active && (trackingError || !active.lastPoint || Date.now() - active.lastPoint.at > LOCATION_STALE_MS)) scheduleRetry()
      emit(); resolve()
    }
    wx.startLocationUpdateBackground({
      success() { started('background') },
      fail(error) {
        backgroundError = (error && error.errMsg) || '后台定位接口未开通'
        wx.startLocationUpdate({
          success() { started('foreground') },
          fail(foregroundError) { trackingMode = ''; trackingError = (foregroundError && foregroundError.errMsg) || backgroundError || '无法开启定位'; emit(); reject(foregroundError || error) }
        })
      }
    })
  }).finally(() => { startPromise = null })
  return startPromise
}
function stopLocation() { clearRetry(); retryAttempts = 0; trackingMode = ''; trackingError = ''; backgroundError = ''; backgroundAuthError = ''; wx.stopLocationUpdate({ fail(error) { console.warn('停止定位失败', error) } }) }
function initialLocation() {
  return new Promise((resolve, reject) => wx.getLocation({
    type: 'gcj02',
    success(location) {
      const lat = Number(location.latitude); const lng = Number(location.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0) || Number(location.accuracy || 0) > 100) {
        reject(new Error('当前位置精度不足，请到开阔处重试'))
      } else resolve(location)
    },
    fail: reject
  }))
}
async function start() {
  if (active) throw new Error('已有工作正在进行')
  const firstLocation = await initialLocation()
  await requestBackgroundPermission()
  await startLocation()
  const settings = store.getSettings()
  const boss = settings.bosses.find(item => item.id === settings.defaultBossId)
  const now = Date.now()
  active = {
    id: `work_${now}_${Math.random().toString(36).slice(2, 9)}`,
    status: 'active', startAt: now, pausedAt: null, pausedMs: 0,
    rateCents: settings.hourlyRateCents, bossId: boss ? boss.id : '', bossName: boss ? boss.name : '未指定老板',
    distanceMeters: 0, pointCount: 0, nextSeq: 1, gapCount: 0, lastPoint: null, segmentBreak: false, buffer: []
  }
  checkpoint()
  store.enqueue({ id: `start_${active.id}`, kind: 'session', session: sessionPayload(active) })
  sync.flush()
  onLocation(firstLocation)
  emit()
  return firstLocation
}
function pause() {
  if (!active || active.status !== 'active') return
  active.status = 'paused'; active.pausedAt = Date.now(); active.lastPoint = null; active.segmentBreak = true
  sealBuffer(); checkpoint(); stopLocation(); emit()
}
async function resume() {
  if (!active || active.status !== 'paused') return
  await requestBackgroundPermission()
  await startLocation()
  active.pausedMs += Date.now() - active.pausedAt
  active.pausedAt = null; active.status = 'active'; active.lastPoint = null; active.segmentBreak = true
  checkpoint(); emit()
  wx.getLocation({ type: 'gcj02', success: onLocation, fail() {} })
}
function sessionPayload(session, endAt) {
  const durationMs = durationAt(session, endAt || Date.now())
  return {
    id: session.id, startAt: session.startAt, endAt: endAt || null,
    durationMs, pausedMs: session.pausedMs, rateCents: session.rateCents,
    amountCents: endAt ? Math.round(session.rateCents * durationMs / 3600000) : 0,
    distanceMeters: Math.round(session.distanceMeters), pointCount: session.pointCount,
    gapCount: session.gapCount, bossId: session.bossId, bossName: session.bossName,
    status: endAt ? 'pending' : 'active', settlementId: null, settledAt: null
  }
}
function finish() {
  if (!active) return null
  const endAt = Date.now()
  if (active.status === 'paused') active.pausedMs += endAt - active.pausedAt
  active.pausedAt = endAt
  sealBuffer()
  const record = sessionPayload(active, endAt)
  store.saveRecord(record)
  store.enqueue({ id: `finish_${active.id}`, kind: 'session', session: record })
  store.saveActive(null)
  active = null
  stopLocation(); sync.flush(); emit()
  return record
}
function recover() {
  if (!recoveredQueue) { store.recoverChunkQueue(); recoveredQueue = true }
  if (!active) active = store.getActive()
  if (active) {
    const finished = store.getRecords().find(x => x.id === active.id)
    if (finished) {
      store.enqueue({ id: `finish_${active.id}`, kind: 'session', session: finished })
      store.saveActive(null)
      active = null
      stopLocation()
    }
  }
  if (active && active.status === 'active' && (!trackingMode || trackingError || !active.lastPoint || Date.now() - active.lastPoint.at > LOCATION_STALE_MS)) {
    startLocation().catch(scheduleRetry)
  }
  emit()
}
function retryBackground() {
  if (!active || active.status !== 'active' || trackingMode === 'background') return Promise.resolve()
  return startLocation()
}
module.exports = { start, pause, resume, finish, recover, retryBackground, checkpoint, snapshot, subscribe, durationAt, amountAt }
