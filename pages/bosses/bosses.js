const store = require('../../services/store')
const sync = require('../../services/sync')
const api = require('../../services/api')
Page({
  data: { bosses: [], defaultBossId: '' },
  onShow() { this.render(); this.pull() },
  render() { const s = store.getSettings(); this.setData({ bosses: s.bosses, defaultBossId: s.defaultBossId }) },
  async pull() {
    if (!api.enabled()) return
    try {
      const remote = await api.call('listBosses')
      const settings = store.getSettings()
      remote.forEach(boss => { if (!settings.bosses.some(x => x.id === boss.id)) settings.bosses.push({ id: boss.id, name: boss.name }) })
      settings.bosses.forEach(boss => {
        const cloudBoss = remote.find(x => x.id === boss.id)
        if (!cloudBoss || cloudBoss.name !== boss.name) store.enqueue({ id: `repair_${boss.id}_${boss.name}`, kind: 'boss', boss })
      })
      store.saveSettings(settings); this.render()
      sync.flush()
    } catch (_) {}
  },
  choose(event) { const settings = store.getSettings(); settings.defaultBossId = event.currentTarget.dataset.id || ''; store.saveSettings(settings); this.render() },
  add() {
    wx.showModal({ title: '添加老板', editable: true, placeholderText: '输入称呼', success: result => {
      if (!result.confirm) return
      const name = (result.content || '').trim().slice(0, 30)
      if (!name) { wx.showToast({ title: '请输入称呼', icon: 'none' }); return }
      const boss = { id: `boss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name }
      const settings = store.getSettings(); settings.bosses.push(boss)
      if (!settings.defaultBossId) settings.defaultBossId = boss.id
      store.saveSettings(settings); store.enqueue({ id: `save_${boss.id}_${Date.now()}`, kind: 'boss', boss }); sync.flush(); this.render()
    } })
  },
  rename(event) {
    const id = event.currentTarget.dataset.id
    const settings = store.getSettings(); const boss = settings.bosses.find(x => x.id === id)
    if (!boss) return
    wx.showModal({ title: '修改称呼', editable: true, placeholderText: boss.name, success: result => {
      if (!result.confirm) return
      const name = (result.content || '').trim().slice(0, 30)
      if (!name) return
      boss.name = name; store.saveSettings(settings)
      store.enqueue({ id: `save_${boss.id}_${Date.now()}`, kind: 'boss', boss: { id, name } }); sync.flush(); this.render()
    } })
  }
})
