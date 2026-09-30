# 贴广告记录器

个人使用的微信小程序。工作、记录、钱包、设置四个入口；工资金额只来自工作记录，结算在云函数中按一批工作原子确认。

## 开始使用

1. 用微信开发者工具打开本目录，确认 `project.config.json` 中的 AppID 是自己的小程序 AppID。
2. 在微信云开发控制台创建环境，创建 `sessions`、`track_chunks`、`bosses`、`settlements` 四个集合。集合客户端权限设为不可读写；所有云读写都经过 `ledger` 云函数，并用微信 `OPENID` 隔离个人数据。
3. 在 [`config.js`](config.js) 填入 `cloudEnvId`。工作地图使用微信原生 `<map>` 和 GCJ-02 定位；当前位置和运动轨迹不需要百度 AK、SK 或自有服务器。
4. 在开发者工具中把项目绑定到该云环境，右键 `cloudfunctions/ledger`，选择「上传并部署：云端安装依赖」。`ledger` 负责工作记录和轨迹云同步。
5. 在微信公众平台申请/开通后台定位相关接口权限，并在真机上授权位置和后台位置。微信官方目前仅对指定类目和业务场景开放该接口，个人贴广告记录用途不一定符合开通条件；未开通时提交含后台定位接口的版本可能被审核拦截。开发者工具模拟器不能验证锁屏后台定位。

相关规则见微信官方的[后台定位接口文档](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.startLocationUpdateBackground.html)和[小程序配置文档](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)。开发版、体验版与正式版的权限和审核结果可能不同。

云环境未就绪时，工作记录和轨迹仍可保存在本机；云同步和结算需要 `ledger` 云函数。开始工作需要先取得有效位置，避免生成没有起点的工作记录。

## 文件与页面

| 路径 | 作用 |
| --- | --- |
| `pages/index` | 开始、暂停、结束工作及实时收入和轨迹 |
| `pages/history`、`pages/detail`、`pages/route` | 日期查询、长按删除、工作详情与工作中/历史全屏轨迹地图 |
| `pages/wallet`、`pages/boss-earnings`、`pages/settlement` | 待结算按老板汇总、逐笔收入明细、批量确认、结算明细 |
| `pages/settings`、`pages/bosses` | 默认时薪、老板、定位说明 |
| `components/track-map` | 微信原生地图、当前位置与分段运动轨迹 |
| `services/tracker.js` | 后台定位、计时、距离计算、本地分批缓存 |
| `services/sync.js` | 本地待同步队列与重试 |
| `cloudfunctions/ledger` | 数据隔离、金额校验、批量结算事务 |

## 数据库

| 集合 | 关键字段 | 建议索引 |
| --- | --- | --- |
| `sessions` | `_id/id`、`owner`、`startAt/endAt`、`pausedMs/durationMs`、`rateCents`、`amountCents`、`distanceMeters`、`pointCount`、`gapCount`、`bossId/bossName`、`status`、`settlementId/settledAt` | `owner` 升序 + `status` 升序 + `startAt` 降序 |
| `track_chunks` | `_id`、`owner`、`sessionId`、`firstSeq/lastSeq`、`points[]` | `owner` 升序 + `sessionId` 升序 + `firstSeq` 升序 |
| `bosses` | `_id/id`、`owner`、`name`、`createdAt` | `owner` 升序 |
| `settlements` | `_id/id`、`owner`、`bossId/bossName`、`sessionIds[]`、`amountCents`、`createdAt` | `owner` 升序 + `createdAt` 降序 |

金额全部使用整数分；有效时长为结束时间减开始时间再减主动暂停时间，每条工作金额为 `round(时薪分 × 有效工作毫秒 / 3,600,000)`。云函数核对时间与金额。钱包总额每次由工作记录求和，不维护另一份易失配的余额。每批结算限 20 笔，云函数再次核对所属老板、待结算状态和预期总额，并在数据库事务中同时更新工作及新增结算记录。记录页长按可确认删除工作及轨迹；云同步启用后，删除需联网完成。如果工作已结算，云函数会在同一事务中从对应结算批次移除这笔工作并减去金额，最后一笔删除时一并删除该结算记录。云端仅保留删除编号、所属用户和删除时间作为防止旧设备重新上传的标记。老板改名不更改已生成记录的历史称呼。

轨迹点按 20 个封装为一个不可变批次，批次 ID 由工作 ID 和首点序号构成，重复上传不会重复计入。工作状态约每 5 秒持久化，本地待同步队列在重新进入小程序时重试。已上传轨迹保留本机副本供短期离线查看；接近本机存储上限时，只清理已经上传的旧批次。完整轨迹以云端为长期副本。

## 定位边界

`wx.startLocationUpdateBackground` 是微信官方允许的后台持续定位方式，配合 `requiredBackgroundModes: ["location"]`、接口开通、用户授权和真机测试使用。开始或继续工作时会请求 `scope.userLocationBackground`；接口不可用或授权失败时，程序退回 `wx.startLocationUpdate` 前台定位，并在工作页弹窗说明失败原因。此时锁屏连续轨迹不能保证，需在小程序设置里允许后台使用位置；若无此选项，还需检查公众平台的后台定位接口权限。系统仍可在强制退出微信、权限撤销、低电量策略或资源回收时停止回调；小程序无法保证被系统终止后继续采集，也无法补出未采集的路线。定位错误会触发限频重试；恢复打开后会读取本机工作状态和已缓存批次，检查定位是否停滞并尝试重新启动。超过一分钟未收到定位或收到定位错误时，恢复后的轨迹会另起一段，不把未采集的路线按直线补齐。断网时批次先保存在本机，之后重试同步。工作时间用起止时间减去主动暂停时间计算，轨迹断档与时间是两种不同数据，地图在暂停和检测到的断档处断开线段，详情页显示断档次数。

开始工作时先调用 `wx.getLocation({ type: 'gcj02' })` 获取起点，随后通过位置更新记录轨迹；原始轨迹点保存在本机并通过 `ledger` 云函数分批同步。原生地图直接使用 GCJ-02，暂停或定位断档时分开线段。结束工作时将剩余轨迹点封装成本地批次，详情页可查看完整轨迹。首次真机测试应检查位置授权和后台定位权限。

## 本地验证

在项目目录运行 `node scripts/validate.js`、`node scripts/test_tracker.js`、`node scripts/test_ledger.js`、`node scripts/test_map.js` 和 `python scripts/validate_wxml.py`。这些检查覆盖页面文件、起点定位、前台定位回退与暂停断线、运动轨迹保存和地图分段、本地删除、轨迹批次幂等、结算、错误金额拒绝及数据归属隔离。最终仍需用微信开发者工具和真机验证授权、锁屏、断网重连与地图显示。
