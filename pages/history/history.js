const records = require('../../services/records')
const store = require('../../services/store')
const format = require('../../utils/format')
const { seedMockRecord } = require('../../services/seed')
Page({
  data: { date: '', items: [], loading: false },
  onShow() { this.load() },
  async load() {
    seedMockRecord()
    this.setData({ loading: true })
    this.render(store.getRecords())
    try { this.render(await records.refreshRecords()) }
    catch (error) { wx.showToast({ title: '云端暂不可用，显示本机记录', icon: 'none' }) }
    this.setData({ loading: false })
  },
  render(list) {
    const items = list.filter(x => !this.data.date || format.day(x.startAt) === this.data.date).map(x => ({
      id: x.id, day: format.day(x.startAt), time: format.dateTime(x.startAt).slice(11), bossName: x.bossName,
      duration: format.duration(x.durationMs), amount: format.money(x.amountCents), status: x.status === 'settled' ? '已结算' : '待结算'
    }))
    this.setData({ items })
  },
  chooseDate(event) { this.setData({ date: event.detail.value }); this.render(store.getRecords()) },
  clearDate() { this.setData({ date: '' }); this.render(store.getRecords()) },
  open(event) {
    if (this.deleting || Date.now() < (this.suppressOpenUntil || 0)) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` })
  },
  confirmDelete(event) {
    if (this.deleting) return
    this.suppressOpenUntil = Date.now() + 1200
    const id = event.currentTarget.dataset.id
    const record = store.getRecords().find(item => item.id === id)
    if (!record) return
    const settled = record.status === 'settled'
    wx.showModal({
      title: '是否删除这条记录？',
      content: settled ? '这条工作已结算。删除后，对应结算记录和钱包金额也会调整，且无法恢复。' : '删除后，本次收入和轨迹也会移除，且无法恢复。',
      confirmText: '删除', confirmColor: '#C5493D',
      success: async result => {
        if (!result.confirm) return
        this.deleting = true
        wx.showLoading({ title: '正在删除' })
        try {
          await records.deleteRecord(id)
          this.render(store.getRecords())
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          this.load()
        } catch (error) {
          wx.hideLoading()
          wx.showModal({ title: '删除失败', content: error.message || '请稍后重试', showCancel: false })
        } finally { this.deleting = false }
      }
    })
  }
})
