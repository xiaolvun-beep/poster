const store = require('../../services/store')
const records = require('../../services/records')
const api = require('../../services/api')
const sync = require('../../services/sync')
const format = require('../../utils/format')
Page({
  data: { record: null, points: [], trackLoading: true, trackText: '读取轨迹中…' },
  onLoad(options) { this.id = options.id; this.load() },
  async load() {
    let item = store.getRecords().find(x => x.id === this.id)
    if (!item && api.enabled()) {
      try { item = await api.call('getSession', { id: this.id }); store.saveRecord(item) } catch (_) {}
    }
    if (!item) { wx.showToast({ title: '找不到工作记录', icon: 'none' }); return }
    this.setData({ record: {
      id: item.id, amount: format.money(item.amountCents), start: format.dateTime(item.startAt), end: format.dateTime(item.endAt),
      duration: format.duration(item.durationMs), rate: format.money(item.rateCents), distance: format.distance(item.distanceMeters),
      boss: item.bossName, status: item.status === 'settled' ? '已结算' : '待结算', settledAt: format.dateTime(item.settledAt), gapCount: item.gapCount || 0,
      bossId: item.bossId, amountCents: item.amountCents
    } })
    this.setData({ trackLoading: true })
    try {
      const points = await records.track(this.id)
      this.setData({ points, trackLoading: false, trackText: points.length ? `${points.length} 个轨迹点` : '本次没有可用轨迹点' })
    } catch (_) { this.setData({ trackLoading: false, trackText: '轨迹暂不可用，请稍后再试' }) }
  },
  openFullMap() {
    if (!this.id) return
    wx.navigateTo({ url: `/pages/route/route?id=${encodeURIComponent(this.id)}` })
  },
  async settleOne() {
    const record = this.data.record
    if (!record || record.status !== '待结算') return
    if (!api.enabled()) { wx.showModal({ title: '需要云同步', content: '请先配置微信云开发环境，再确认工资结算。', showCancel: false }); return }
    const confirmed = await new Promise(resolve => wx.showModal({ title: '确认已收到工资', content: `本次工作实收 ¥${record.amount}？`, confirmText: '已收到', success: result => resolve(result.confirm), fail: () => resolve(false) }))
    if (!confirmed) return
    wx.showLoading({ title: '正在核对' })
    try {
      await sync.flush()
      if (store.pending().some(x => x.kind === 'session' && x.session.id === record.id)) throw new Error('工作尚未上传，请联网后重试')
      const requestId = `settle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      const result = await api.call('settle', { requestId, bossId: record.bossId, sessionIds: [record.id], expectedCents: record.amountCents })
      store.saveSettlement(result)
      const item = store.getRecords().find(x => x.id === record.id)
      if (item) store.saveRecord(Object.assign({}, item, { status: 'settled', settlementId: result.id, settledAt: result.createdAt }))
      await this.load()
      wx.showToast({ title: '结算已记录', icon: 'success' })
    } catch (error) { wx.showModal({ title: '未完成结算', content: error.message || '请稍后重试', showCancel: false }) }
    finally { wx.hideLoading() }
  }
})
