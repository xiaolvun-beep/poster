const records = require('../../services/records')
const tracker = require('../../services/tracker')
const store = require('../../services/store')

Page({
  data: { points: [], loading: true, live: false, backTop: 32 },
  onLoad(options) {
    this.id = options.id
    this.live = options.live === '1'
    this.setData({ live: this.live })
    let statusBarHeight = 24
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      if (Number.isFinite(Number(info.statusBarHeight))) statusBarHeight = Number(info.statusBarHeight)
    } catch (_) {}
    this.setData({ backTop: statusBarHeight + 8 })
    if (!this.live) this.loadTrack()
  },
  onShow() {
    if (!this.live) return
    tracker.recover()
    this.lastPointCount = -1
    this.renderLiveTrack()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.renderLiveTrack(), 1000)
  },
  onHide() { clearInterval(this.timer) },
  onUnload() { clearInterval(this.timer) },
  renderLiveTrack() {
    const session = tracker.snapshot().session
    if (!session || session.id !== this.id) {
      clearInterval(this.timer)
      this.live = false
      this.setData({ live: false })
      this.loadTrack()
      return
    }
    if (session.pointCount === this.lastPointCount) return
    this.lastPointCount = session.pointCount
    this.setData({ points: store.getLocalTrack(session.id).concat(session.buffer || []), loading: false })
  },
  async loadTrack() {
    if (!this.id) { this.setData({ loading: false }); return }
    try {
      const points = await records.track(this.id)
      this.setData({ points, loading: false })
    } catch (_) {
      this.setData({ loading: false })
      wx.showToast({ title: '轨迹暂不可用', icon: 'none' })
    }
  },
  back() { wx.navigateBack({ delta: 1 }) }
})
