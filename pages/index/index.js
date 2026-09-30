const tracker = require('../../services/tracker')
const store = require('../../services/store')
const api = require('../../services/api')
const format = require('../../utils/format')

Page({
  data: { working: false, paused: false, starting: false, busy: false, duration: '00:00:00', income: '0.00', distance: '0 m', pointCount: 0, points: [], trackingError: '', syncStatus: '' },
  onShow() { tracker.recover(); this.render(); clearInterval(this.timer); this.timer = setInterval(() => this.render(), 1000) },
  onHide() { clearInterval(this.timer) },
  onUnload() { clearInterval(this.timer) },
  updateChanged(next) {
    const changed = {}
    Object.keys(next).forEach(key => { if (next[key] !== this.data[key]) changed[key] = next[key] })
    if (Object.keys(changed).length) this.setData(changed)
  },
  render() {
    const { session, trackingError } = tracker.snapshot()
    if (!session) {
      if (this.data.working) this.updateChanged({ working: false, paused: false, duration: '00:00:00', income: '0.00', distance: '0 m', pointCount: 0, points: [], trackingError: '', syncStatus: '' })
      return
    }
    const now = Date.now()
    const syncStatus = api.enabled() ? (store.pending().length ? '等待同步' : '轨迹已缓存') : '本机保存 · 云同步待配置'
    const next = {
      working: true, paused: session.status === 'paused', duration: format.duration(tracker.durationAt(session, now)),
      income: format.money(tracker.amountAt(session, now)), distance: format.distance(session.distanceMeters), pointCount: session.pointCount || 0,
      trackingError, syncStatus
    }
    if (session.pointCount !== this.lastPointCount && (!this.lastMapAt || now - this.lastMapAt >= 3000)) {
      next.points = store.getLocalTrack(session.id).concat(session.buffer)
      this.lastPointCount = session.pointCount
      this.lastMapAt = now
    }
    this.updateChanged(next)
  },
  warnForeground() {
    const { trackingMode, backgroundPermissionDenied, backgroundError } = tracker.snapshot()
    if (trackingMode !== 'foreground') return
    wx.showModal({
      title: '锁屏轨迹可能中断',
      content: `当前只获得前台定位。请允许微信在离开小程序后使用位置；如果设置里没有这个选项，还需要开通小程序后台定位接口。${backgroundError ? `\n后台启动失败：${backgroundError}` : ''}`,
      showCancel: backgroundPermissionDenied,
      cancelText: '继续使用',
      confirmText: backgroundPermissionDenied ? '打开设置' : '我知道了',
      success(result) {
        if (backgroundPermissionDenied && result.confirm && wx.openSetting) {
          wx.openSetting({ success() { tracker.retryBackground().catch(() => {}) } })
        }
      }
    })
  },
  openFullMap() {
    const session = tracker.snapshot().session
    if (session) wx.navigateTo({ url: `/pages/route/route?live=1&id=${encodeURIComponent(session.id)}` })
  },
  async start() {
    if (this.data.starting || this.data.working) return
    this.setData({ starting: true })
    try { await tracker.start(); this.lastMapAt = 0; this.lastPointCount = -1; this.render(); this.warnForeground() }
    catch (error) {
      const reason = error.errMsg || error.message || ''
      wx.showModal({ title: '无法开始定位', content: /精度不足/.test(reason) ? reason : `请允许微信使用位置和后台位置，并在系统设置中保持定位开启。${reason}`, showCancel: false })
    }
    finally { this.setData({ starting: false }) }
  },
  async pauseOrResume() {
    if (this.data.busy) return
    const session = tracker.snapshot().session
    if (!session) return
    const wasPaused = session.status === 'paused'
    this.setData({ busy: true })
    try { if (wasPaused) await tracker.resume(); else tracker.pause(); this.render(); if (wasPaused) this.warnForeground() }
    catch (error) { wx.showToast({ title: '恢复定位失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  finish() {
    if (this.data.busy) return
    this.setData({ busy: true })
    wx.showModal({ title: '结束本次工作？', content: '结束后会生成一条待结算工作记录。', success: result => {
      if (!result.confirm) { this.setData({ busy: false }); return }
      try {
        tracker.finish(); this.lastPointCount = -1; this.lastMapAt = 0; this.setData({ points: [] }); this.render()
        wx.showToast({ title: '工作已保存', icon: 'success' })
      } catch (error) { wx.showModal({ title: '保存失败', content: error.message || '请检查手机存储空间后重试', showCancel: false }) }
      finally { this.setData({ busy: false }) }
    }, fail: () => this.setData({ busy: false }) })
  }
})
