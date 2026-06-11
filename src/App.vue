<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

type MarketDataPoint = {
  start_timestamp: number
  marketprice: number
}

type MarketDataResponse = {
  data: MarketDataPoint[]
}

type ChartPoint = {
  start_timestamp: number
  marketpriceCt: number
}

const marketData = ref<MarketDataPoint[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const sendingTelegram = ref(false)
const telegramStatus = ref<string | null>(null)
const telegramError = ref<string | null>(null)

const chartWidth = 900
const chartHeight = 420
const padding = { top: 40, right: 24, bottom: 56, left: 72 }
const PRICE_API_URL = 'https://api.awattar.at/v1/marketdata'
const TARGET_TIMEZONE = 'Europe/Vienna'

function toCtPerKwh(priceEurPerMwh: number) {
  return priceEurPerMwh / 10
}

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
}

function getDatePartsInTimezone(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
  }
}

function shiftDate(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function getOffsetMsAt(timeZone: string, timestamp: number) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(new Date(timestamp))
  const zone = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] ?? '0')
  const minutes = Number(match[3] ?? '0')
  return sign * (hours * 60 + minutes) * 60 * 1000
}

function getMidnightUtcMs(year: number, month: number, day: number, timeZone: string) {
  const approxUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  return approxUtc - getOffsetMsAt(timeZone, approxUtc)
}

function buildMarketDataUrl() {
  const now = new Date()
  const current = getDatePartsInTimezone(now, TARGET_TIMEZONE)
  const startBase = current.hour >= 14 ? 1 : 0
  const startDate = shiftDate(current.year, current.month, current.day, startBase)
  const endDate = shiftDate(startDate.year, startDate.month, startDate.day, 1)

  const start = getMidnightUtcMs(startDate.year, startDate.month, startDate.day, TARGET_TIMEZONE)
  const end = getMidnightUtcMs(endDate.year, endDate.month, endDate.day, TARGET_TIMEZONE)

  return `${PRICE_API_URL}?start=${start}&end=${end}`
}

const visibleData = computed<ChartPoint[]>(() =>
  marketData.value.slice(0, 24).map((p) => ({
    start_timestamp: p.start_timestamp,
    marketpriceCt: toCtPerKwh(p.marketprice),
  })),
)

const minPriceRaw = computed(() => {
  if (!visibleData.value.length) return 0
  return Math.min(...visibleData.value.map((p) => p.marketpriceCt))
})

const maxPriceRaw = computed(() => {
  if (!visibleData.value.length) return 0
  return Math.max(...visibleData.value.map((p) => p.marketpriceCt))
})

const minPrice = computed(() => Math.min(minPriceRaw.value, 0))
const maxPrice = computed(() => Math.max(maxPriceRaw.value, 0))

const priceRange = computed(() => {
  const range = maxPrice.value - minPrice.value
  return range === 0 ? 1 : range
})

const averagePrice = computed(() => {
  if (!visibleData.value.length) return 0
  const sum = visibleData.value.reduce((acc, item) => acc + item.marketpriceCt, 0)
  return sum / visibleData.value.length
})

const negativeHours = computed(() => visibleData.value.filter((item) => item.marketpriceCt < 0).length)

const chartDateLabel = computed(() => {
  if (!visibleData.value.length) return ''
  const firstPoint = visibleData.value[0]
  const lastPoint = visibleData.value[visibleData.value.length - 1]
  if (!firstPoint || !lastPoint) return ''
  const first = firstPoint.start_timestamp
  const last = lastPoint.start_timestamp

  const firstDate = new Date(first).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })
  const lastDate = new Date(last).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  })

  return firstDate === lastDate ? firstDate : `${firstDate} - ${lastDate}`
})

const yTicks = computed(() => {
  const tickCount = 7
  const min = minPrice.value
  const max = maxPrice.value

  if (max === min) return [min]

  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const ratio = i / (tickCount - 1)
    return max - ratio * (max - min)
  })

  if (!ticks.some((tick) => Math.abs(tick) < 0.0001)) {
    ticks.push(0)
  }

  return [...new Set(ticks.map((tick) => Number(tick.toFixed(2))))].sort((a, b) => b - a)
})

const zeroY = computed(() => yForPrice(0))

function formatHour(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('de-AT', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPrice(priceCtPerKwh: number) {
  return `${priceCtPerKwh.toFixed(2)} ct/kWh`
}

function xForIndex(index: number, count = visibleData.value.length) {
  return barX(index, count) + barWidth(count) / 2
}

function yForPrice(price: number) {
  const plotHeight = chartHeight - padding.top - padding.bottom
  const max = maxPrice.value
  return padding.top + ((max - price) / priceRange.value) * plotHeight
}

function barWidth(count: number) {
  const plotWidth = chartWidth - padding.left - padding.right
  if (count <= 1) return plotWidth * 0.7

  const slotWidth = plotWidth / count
  return Math.max(6, slotWidth * 0.72)
}

function barX(index: number, count: number) {
  const width = barWidth(count)

  if (count <= 1) {
    return padding.left + ((chartWidth - padding.left - padding.right) - width) / 2
  }

  const plotWidth = chartWidth - padding.left - padding.right
  const slotWidth = plotWidth / count
  return padding.left + slotWidth * index + (slotWidth - width) / 2
}

function barY(price: number) {
  const rawY = price >= 0 ? yForPrice(price) : zeroY.value
  return Math.max(padding.top, Math.min(rawY, chartHeight - padding.bottom))
}

function barHeight(price: number) {
  const top = Math.min(yForPrice(price), zeroY.value)
  const bottom = Math.max(yForPrice(price), zeroY.value)
  const clampedTop = Math.max(padding.top, top)
  const clampedBottom = Math.min(chartHeight - padding.bottom, bottom)
  return Math.max(1, clampedBottom - clampedTop)
}

function barPriceY(price: number) {
  const top = Math.min(yForPrice(price), zeroY.value)
  return Math.max(14, top - 6)
}

async function fetchMarketData() {
  loading.value = true
  error.value = null

  try {
    const response = await fetch(buildMarketDataUrl())

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data: MarketDataResponse = await response.json()
    marketData.value = data.data ?? []
  } catch (err) {
    console.error('Failed to load aWATTar data:', err)
    error.value = 'Prices could not be loaded.'
  } finally {
    loading.value = false
  }
  console.log('Current aWATTar data:', marketData.value)
}

onMounted(() => {
  fetchMarketData()
})

async function sendTelegramMessage() {
  sendingTelegram.value = true
  telegramStatus.value = null
  telegramError.value = null

  try {
    const response = await fetch('/api/telegram/send', { method: 'POST' })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error ?? `Error: ${response.status}`)
    }
    telegramStatus.value = 'Telegram message sent.'
  } catch (err) {
    console.error('Failed to send Telegram message:', err)
    telegramError.value = err instanceof Error ? err.message : 'Telegram message could not be sent.'
  } finally {
    sendingTelegram.value = false
  }
}
</script>

<template>
  <main class="dashboard">
    <header class="hero">
      <h1>aWATTar Electricity Price Dashboard</h1>
      <p>24-hour view with positive and negative price zones.</p>
      <p v-if="chartDateLabel" class="date-label">Day: {{ chartDateLabel }}</p>
      <div class="telegram-actions">
        <button class="telegram-button" :disabled="sendingTelegram" @click="sendTelegramMessage">
          {{ sendingTelegram ? 'Sending message ...' : 'Send Telegram message' }}
        </button>
        <p v-if="telegramStatus" class="telegram-status">{{ telegramStatus }}</p>
        <p v-if="telegramError" class="telegram-error">{{ telegramError }}</p>
      </div>
    </header>

    <section class="status-card" v-if="loading">Loading price data ...</section>
    <section class="status-card status-card-error" v-else-if="error">{{ error }}</section>

    <section v-else-if="visibleData.length" class="panel">
      <div class="kpis">
        <article class="kpi">
          <span>Daily minimum</span>
          <strong>{{ formatPrice(minPriceRaw) }}</strong>
        </article>
        <article class="kpi">
          <span>Daily maximum</span>
          <strong>{{ formatPrice(maxPriceRaw) }}</strong>
        </article>
        <article class="kpi">
          <span>Average</span>
          <strong>{{ formatPrice(averagePrice) }}</strong>
        </article>
        <article class="kpi">
          <span>Negative hours</span>
          <strong>{{ negativeHours }}</strong>
        </article>
      </div>

      <svg
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        class="chart"
        role="img"
        aria-label="Bar chart of aWATTar prices with positive and negative zones"
      >
        <line
          :x1="padding.left"
          :x2="chartWidth - padding.right"
          :y1="zeroY"
          :y2="zeroY"
          class="zero-line"
        />

        <line
          :x1="padding.left"
          :x2="padding.left"
          :y1="padding.top"
          :y2="chartHeight - padding.bottom"
          class="axis"
        />
        <line
          :x1="padding.left"
          :x2="chartWidth - padding.right"
          :y1="chartHeight - padding.bottom"
          :y2="chartHeight - padding.bottom"
          class="axis"
        />

        <g v-for="(tick, idx) in yTicks" :key="`tick-${idx}`">
          <line
            :x1="padding.left"
            :x2="chartWidth - padding.right"
            :y1="yForPrice(tick)"
            :y2="yForPrice(tick)"
            class="grid"
            :class="{ 'grid-zero': tick === 0 }"
          />
          <text :x="padding.left - 10" :y="yForPrice(tick) + 4" class="tick-label">
            {{ tick.toFixed(1) }}
          </text>
        </g>

        <g v-for="(point, index) in visibleData" :key="point.start_timestamp">
          <rect
            :x="barX(index, visibleData.length)"
            :y="barY(point.marketpriceCt)"
            :width="barWidth(visibleData.length)"
            :height="barHeight(point.marketpriceCt)"
            class="bar"
            :class="point.marketpriceCt < 0 ? 'bar-negative' : 'bar-positive'"
          />
          <text :x="xForIndex(index)" :y="barPriceY(point.marketpriceCt)" class="bar-price">
            {{ point.marketpriceCt.toFixed(1) }}
          </text>
          <title>{{ formatHour(point.start_timestamp) }} · {{ formatPrice(point.marketpriceCt) }}</title>
        </g>

        <text
          v-for="(point, index) in visibleData"
          v-show="index % 3 === 0"
          :key="`label-${point.start_timestamp}`"
          :x="xForIndex(index)"
          :y="chartHeight - 14"
          class="tick-label x-label"
        >
          {{ formatHour(point.start_timestamp) }}
        </text>

        <line
          :x1="padding.left"
          :x2="chartWidth - padding.right"
          :y1="yForPrice(averagePrice)"
          :y2="yForPrice(averagePrice)"
          class="average-line"
        />
        <text :x="chartWidth - padding.right - 4" :y="yForPrice(averagePrice) - 6" class="average-label">
          Ø {{ averagePrice.toFixed(2) }}
        </text>

        <text :x="padding.left - 52" :y="padding.top - 12" class="axis-title">ct/kWh</text>
      </svg>
    </section>
  </main>
</template>

<style scoped>
.dashboard {
  min-height: 100vh;
  padding: 40px 20px;
  background:
    radial-gradient(circle at 0% 0%, #f9fbf4 0%, transparent 45%),
    radial-gradient(circle at 100% 100%, #eef4ff 0%, transparent 45%),
    linear-gradient(165deg, #f5f8ee 0%, #edf3f8 100%);
  color: #173028;
}

.hero {
  max-width: 1000px;
  margin: 0 auto 20px;
}

.hero h1 {
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  line-height: 1.15;
  font-weight: 700;
}

.hero p {
  margin-top: 8px;
  color: #32534a;
}

.date-label {
  font-weight: 600;
}

.telegram-actions {
  margin-top: 14px;
}

.telegram-button {
  border: 1px solid #0f5d4c;
  background: #127a65;
  color: #fff;
  border-radius: 10px;
  padding: 9px 14px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.telegram-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.telegram-status {
  margin-top: 8px;
  color: #1f5b2f;
  font-size: 0.92rem;
}

.telegram-error {
  margin-top: 8px;
  color: #8f1f29;
  font-size: 0.92rem;
}

.panel,
.status-card {
  max-width: 1000px;
  margin: 0 auto;
  border: 1px solid #cfd8ce;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 12px 30px rgba(30, 63, 54, 0.1);
  backdrop-filter: blur(4px);
}

.panel {
  padding: 18px 16px 12px;
}

.status-card {
  padding: 22px;
}

.status-card-error {
  color: #8f1f29;
  border-color: #e5bcc2;
}

.kpis {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 16px;
}

.kpi {
  padding: 10px 12px;
  border-radius: 12px;
  background: linear-gradient(145deg, #f7faf3, #f0f6ef);
  border: 1px solid #d9e3d6;
}

.kpi span {
  display: block;
  font-size: 0.78rem;
  color: #4e6d64;
}

.kpi strong {
  display: block;
  margin-top: 2px;
  font-size: 1.08rem;
  color: #173028;
}

.chart {
  width: 100%;
  height: auto;
  border-radius: 12px;
  background: linear-gradient(180deg, #fcfffb 0%, #f6fbf6 100%);
}

.axis {
  stroke: #6f897f;
  stroke-width: 1.15;
}

.grid {
  stroke: #d8e2d8;
  stroke-width: 1.05;
}

.grid-zero {
  stroke: #7f9085;
  stroke-dasharray: 4 4;
}

.zero-line {
  stroke: #6e8579;
  stroke-width: 1.5;
  stroke-dasharray: 6 5;
}

.average-line {
  stroke: #040404;
  stroke-width: 1.5;
  stroke-dasharray: 7 4;
}

.average-label {
  font-size: 11px;
  fill: #040404;
  font-weight: 700;
  text-anchor: end;
}

.bar {
  transition: opacity 0.2s ease;
}

.bar:hover {
  opacity: 0.84;
}

.bar-positive {
  fill: #127a65;
}

.bar-negative {
  fill: #d64949;
}

.bar-price {
  font-size: 10px;
  fill: #27443b;
  font-weight: 600;
  text-anchor: middle;
}

.tick-label {
  font-size: 11px;
  fill: #4b635a;
  text-anchor: end;
}

.x-label {
  text-anchor: middle;
}

.axis-title {
  font-size: 12px;
  fill: #4b635a;
  font-weight: 600;
}

@media (min-width: 780px) {
  .kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
