const store = require('../../services/store')
const records = require('../../services/records')
const sync = require('../../services/sync')
const api = require('../../services/api')
const format = require('../../utils/format')

Page({
  data: { pending: '0.00', earned: '0.00', settled: '0.00', groups: [], settlements: [], cloudReady: false },
  onShow() { this.load() },
  async load() {
    this.render()
    try { await records.refreshRecords(); await records.refreshSettlements(); this.render() }
    catch (_) { wx.showToast({ title: '云端暂不可用，显示本机账本', icon: 'none' }) }
  },
  render() {
    const all = store.getRecords()
    const earned = all.reduce((sum, x) => sum + x.amountCents, 0)
    const settled = all.filter(x => x.status === 'settled').reduce((sum, x) => sum + x.amountCents, 0)
    const groups = {}
    const bossNames = Object.fromEntries(store.getSettings().bosses.map(x => [x.id, x.name]))
    all.filter(x => x.status === 'pending').forEach(x => {
      const key = x.bossId || '__none__'
      if (!groups[key]) groups[key] = { bossId: x.bossId, bossName: bossNames[x.bossId] || x.bossName || '未指定老板', count: 0, cents: 0, ids: [], batchCents: 0 }
      groups[key].count++; groups[key].cents += x.amountCents
      if (groups[key].ids.length < 20) { groups[key].ids.push(x.id); groups[key].batchCents += x.amountCents }
    })
    this.setData({
      earned: format.money(earned), settled: format.money(settled), pending: format.money(earned - settled),
      groups: Object.values(groups).map(g => Object.assign(g, { money: format.money(g.cents), batchMoney: format.money(g.batchCents), buttonText: g.count > 20 ? `确认收到本批 20 笔 ¥${format.money(g.batchCents)}` : `确认收到 ¥${format.money(g.cents)}` })),
      settlements: store.getSettlements().map(x => ({ id: x.id, bossName: x.bossName, amount: format.money(x.amountCents), time: format.dateTime(x.createdAt), count: x.sessionIds.length })),
      cloudReady: api.enabled()
    })
  },
  async settle(event) {
    const group = this.data.groups.find(x => (x.bossId || '') === (event.currentTarget.dataset.boss || ''))
    if (!group) return
    if (!api.enabled()) { wx.showModal({ title: '需要云同步', content: '请先配置微信云开发环境，结算需要在云端原子完成。', showCancel: false }); return }
    const confirmation = await new Promise(resolve => wx.showModal({ title: '确认已收到工资', content: `${group.bossName} · ${group.ids.length} 笔 · ¥${group.batchMoney}。只有实际收到这笔钱后才确认。`, confirmText: '已收到', success: result => resolve(result.confirm), fail: () => resolve(false) }))
    if (!confirmation) return
    wx.showLoading({ title: '正在核对' })
    try {
      await sync.flush()
      const queued = store.pending().some(x => x.kind === 'session' && group.ids.some(id => x.session.id === id))
      if (queued) throw new Error('这些工作仍在等待上传，请联网后重试')
      const requestId = `settle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      const result = await api.call('settle', { requestId, bossId: group.bossId, sessionIds: group.ids, expectedCents: group.batchCents })
      store.saveSettlement(result)
      group.ids.forEach(id => {
        const record = store.getRecords().find(x => x.id === id)
        if (record) store.saveRecord(Object.assign({}, record, { status: 'settled', settlementId: result.id, settledAt: result.createdAt }))
      })
      this.render()
      wx.showToast({ title: '结算已记录', icon: 'success' })
    } catch (error) { wx.showModal({ title: '未完成结算', content: error.message || '请稍后重试', showCancel: false }); this.load() }
    finally { wx.hideLoading() }
  },
  openBossEarnings(event) {
    const bossId = event.currentTarget.dataset.boss || ''
    wx.navigateTo({ url: `/pages/boss-earnings/boss-earnings?bossId=${encodeURIComponent(bossId)}` })
  },
  openSettlement(event) { wx.navigateTo({ url: `/pages/settlement/settlement?id=${event.currentTarget.dataset.id}` }) }
})
