const config = require('../config')
function enabled() { return !!(config.cloudEnvId && wx.cloud) }
function call(action, payload) {
  if (!enabled()) return Promise.reject(new Error('请先在 config.js 配置微信云开发环境 ID'))
  return wx.cloud.callFunction({ name: 'ledger', data: Object.assign({ action }, payload || {}) }).then(result => {
    const data = result.result || {}
    if (!data.ok) throw new Error(data.error || '云端操作失败')
    return data.data
  })
}
module.exports = { enabled, call }
