const api = require('../../services/api')
const store = require('../../services/store')
const format = require('../../utils/format')
Page({
  data: { settlement: null, items: [] },
  onLoad(options) { this.id = options.id; this.load() },
  async load() {
    let settlement = store.getSettlements().find(x => x.id === this.id)
    let items = settlement ? store.getRecords().filter(x => settlement.sessionIds.includes(x.id)) : []
    if (api.enabled()) {
      try {
        const result = await api.call('getSettlement', { id: this.id })
        settlement = result.settlement; items = result.sessions
        store.saveSettlement(settlement); items.forEach(store.saveRecord)
      } catch (_) {}
    }
    if (!settlement) { wx.showToast({ title: '找不到结算记录', icon: 'none' }); return }
    this.setData({
      settlement: { boss: settlement.bossName, amount: format.money(settlement.amountCents), time: format.dateTime(settlement.createdAt), count: settlement.sessionIds.length },
      items: items.map(x => ({ id: x.id, date: format.dateTime(x.startAt), amount: format.money(x.amountCents), duration: format.duration(x.durationMs) }))
    })
  },
  open(event) { wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` }) }
})
