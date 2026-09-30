function validPoint(point) {
  return point && point.latitude !== null && point.longitude !== null &&
    Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 && Math.abs(Number(point.longitude)) <= 180
}

const ROUTE_COLOR = '#2D7FF9'

function routeLine(points) {
  return { points, color: ROUTE_COLOR, width: 4 }
}

function buildMapData(rawPoints, live) {
  const points = (rawPoints || []).filter(validPoint).map(point => ({
    latitude: Number(point.latitude), longitude: Number(point.longitude), breakBefore: !!point.breakBefore
  }))
  const polylines = []
  let segment = []
  points.forEach(point => {
    if (point.breakBefore && segment.length) {
      if (segment.length > 1) polylines.push(routeLine(segment))
      segment = []
    }
    segment.push({ latitude: point.latitude, longitude: point.longitude })
  })
  if (segment.length > 1) polylines.push(routeLine(segment))

  const first = points[0]
  const last = points[points.length - 1]
  const bounds = points.reduce((box, point) => ({
    minLat: Math.min(box.minLat, point.latitude), maxLat: Math.max(box.maxLat, point.latitude),
    minLng: Math.min(box.minLng, point.longitude), maxLng: Math.max(box.maxLng, point.longitude)
  }), { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 })
  const circles = []
  if (first) circles.push({ latitude: first.latitude, longitude: first.longitude, radius: 4, color: '#FFFFFFFF', fillColor: '#22C55E', strokeWidth: 1 })
  if (last && points.length > 1) circles.push({ latitude: last.latitude, longitude: last.longitude, radius: 4, color: '#FFFFFFFF', fillColor: '#EF4444', strokeWidth: 1 })

  return {
    hasPoints: !!last,
    latitude: last ? last.latitude : 0,
    longitude: last ? last.longitude : 0,
    scale: live ? 17 : 15,
    polylines, circles,
    fitPoints: points.length ? [
      { latitude: bounds.minLat, longitude: bounds.minLng },
      { latitude: bounds.maxLat, longitude: bounds.maxLng }
    ] : []
  }
}

Component({
  properties: {
    points: { type: Array, value: [], observer() { this.syncMap() } },
    live: { type: Boolean, value: false },
    fitAll: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    fullscreen: { type: Boolean, value: false },
    openable: { type: Boolean, value: false },
    backTop: { type: Number, value: 32 }
  },
  data: { hasPoints: false, latitude: 0, longitude: 0, scale: 17, polylines: [], circles: [] },
  lifetimes: { ready() { this._ready = true; this.syncMap() } },
  methods: {
    onBack() { this.triggerEvent('back') },
    onMapTap() { if (this.data.openable) this.triggerEvent('open') },
    syncMap() {
      const map = buildMapData(this.data.points, this.data.live)
      this.setData({
        hasPoints: map.hasPoints, latitude: map.latitude, longitude: map.longitude, scale: map.scale,
        polylines: map.polylines, circles: map.circles
      }, () => {
        if (this._ready && this.data.fitAll && map.fitPoints.length > 1 && wx.createMapContext) {
          wx.createMapContext('track-map', this).includePoints({ points: map.fitPoints, padding: [40, 40, 40, 40] })
        }
      })
    }
  }
})

module.exports = { buildMapData }
