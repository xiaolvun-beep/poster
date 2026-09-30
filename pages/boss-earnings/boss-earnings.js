const store = require('../../services/store')
const records = require('../../services/records')
const format = require('../../utils/format')

Page({
  data: { bossName: '未指定老板', total: '0.00', count: 0, items: [], loading: true },
  onLoad(options) { this.bossId = options.bossId || '' },
  onShow() { this.load() },
  async load() {
    this.setData({ loading: true })
    this.render(store.getRecords())
    try { this.render(await records.refreshRecords()) }
    catch (_) { wx.showToast({ title: '云端暂不可用，显示本机账本', icon: 'none' }) }
    this.setData({ loading: false })
  },
  render(recordsList) {
    const matching = recordsList.filter(x => x.status === 'pending' && (x.bossId || '') === this.bossId)
    const boss = store.getSettings().bosses.find(x => x.id === this.bossId)
    const bossName = boss ? boss.name : (matching[0] && matching[0].bossName) || '未指定老板'
    const totalCents = matching.reduce((sum, x) => sum + x.amountCents, 0)
    this.setData({
      bossName, total: format.money(totalCents), count: matching.length,
      items: matching.map(x => ({
        id: x.id, date: format.dateTime(x.startAt), duration: format.duration(x.durationMs),
        amount: format.money(x.amountCents)
      }))
    })
  },
  open(event) { wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }) }
})
