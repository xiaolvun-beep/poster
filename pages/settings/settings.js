const store = require('../../services/store')
const format = require('../../utils/format')
Page({
  data: { rate: '25.00', bossName: '未指定老板' },
  onShow() { this.render() },
  render() {
    const settings = store.getSettings()
    const boss = settings.bosses.find(x => x.id === settings.defaultBossId)
    this.setData({ rate: format.money(settings.hourlyRateCents), bossName: boss ? boss.name : '未指定老板' })
  },
  saveRate(event) {
    const value = Number(event.detail.value)
    if (!Number.isFinite(value) || value <= 0 || value > 10000) { wx.showToast({ title: '请输入有效时薪', icon: 'none' }); this.render(); return }
    const settings = store.getSettings()
    settings.hourlyRateCents = Math.round(value * 100)
    store.saveSettings(settings); this.render()
    wx.showToast({ title: '已保存', icon: 'success' })
  },
  openBosses() { wx.navigateTo({ url: '/pages/bosses/bosses' }) }
})
