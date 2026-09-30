const config = require('./config')
const tracker = require('./services/tracker')
const sync = require('./services/sync')
const { seedMockRecord } = require('./services/seed')

App({
  onLaunch() {
    if (wx.cloud && config.cloudEnvId) wx.cloud.init({ env: config.cloudEnvId, traceUser: false })
    seedMockRecord()
    tracker.recover()
    sync.flush()
  },
  onShow() {
    tracker.recover()
    sync.flush()
  },
  onHide() {
    tracker.checkpoint()
    sync.flush()
  }
})
