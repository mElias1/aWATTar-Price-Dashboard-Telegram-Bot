const TOKEN = process.env.BOT_TOKEN
const CHAT_ID = process.env.CHAT_ID
const PRICE_API_URL = process.env.PRICE_API_URL ?? "https://api.awattar.at/v1/marketdata"
const TARGET_TIMEZONE = "Europe/Vienna"

function assertEnv() {
  if (!TOKEN) throw new Error("Missing BOT_TOKEN")
  if (!CHAT_ID) throw new Error("Missing CHAT_ID")
}

function toCtPerKwh(priceEurPerMwh) {
  return priceEurPerMwh / 10
}

function getDatePartsInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
  const parts = formatter.formatToParts(date)
  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0")

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
  }
}

function shiftDate(year, month, day, days) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function getOffsetMsAt(timeZone, timestamp) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const parts = formatter.formatToParts(new Date(timestamp))
  const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+0"
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0

  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2] ?? "0")
  const minutes = Number(match[3] ?? "0")
  return sign * (hours * 60 + minutes) * 60 * 1000
}

function getMidnightUtcMs(year, month, day, timeZone) {
  const approxUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  return approxUtc - getOffsetMsAt(timeZone, approxUtc)
}

function buildPriceUrl() {
  const now = new Date()
  const current = getDatePartsInTimezone(now, TARGET_TIMEZONE)
  const startBase = current.hour >= 14 ? 1 : 0
  const startDate = shiftDate(current.year, current.month, current.day, startBase)
  const endDate = shiftDate(startDate.year, startDate.month, startDate.day, 1)

  const start = getMidnightUtcMs(startDate.year, startDate.month, startDate.day, TARGET_TIMEZONE)
  const end = getMidnightUtcMs(endDate.year, endDate.month, endDate.day, TARGET_TIMEZONE)

  return `${PRICE_API_URL}?start=${start}&end=${end}`
}

function formatHour(timestamp) {
  return new Date(timestamp).toLocaleTimeString("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Vienna",
  })
}

function formatHourRange(startTimestamp, endTimestamp) {
  return `${formatHour(startTimestamp)}-${formatHour(endTimestamp)}`
}

async function getPrices() {
  const res = await fetch(buildPriceUrl())
  if (!res.ok) throw new Error(`Price API error: ${res.status}`)
  const json = await res.json()
  return (json.data ?? []).slice(0, 24)
}

function getAverageCtPerKwh(data) {
  if (!data.length) return 0
  const sum = data.reduce((total, item) => total + toCtPerKwh(item.marketprice), 0)
  return sum / data.length
}

function getNegativePriceHours(data) {
  return data.filter((item) => toCtPerKwh(item.marketprice) < 0)
}

function getCheapestHours(data, maxCount = 5) {
  return [...data]
    .sort((a, b) => a.marketprice - b.marketprice)
    .slice(0, maxCount)
    .sort((a, b) => a.start_timestamp - b.start_timestamp)
}

function getCheapestTimeWindows(data, durationHours, maxCount = 3) {
  if (!data.length || durationHours <= 0 || data.length < durationHours) return []

  const windows = []
  for (let i = 0; i <= data.length - durationHours; i += 1) {
    const windowItems = data.slice(i, i + durationHours)
    const totalCt = windowItems.reduce((sum, item) => sum + toCtPerKwh(item.marketprice), 0)
    windows.push({
      start_timestamp: windowItems[0].start_timestamp,
      end_timestamp: windowItems[windowItems.length - 1].end_timestamp,
      averageCtPerKwh: totalCt / durationHours,
    })
  }

  return windows
    .sort((a, b) => a.averageCtPerKwh - b.averageCtPerKwh)
    .slice(0, maxCount)
    .sort((a, b) => a.start_timestamp - b.start_timestamp)
}

function formatSavingsHints(data) {
  const applianceRecommendations = [
    { label: "Air conditioning (1h)", durationHours: 1 },
    { label: "Dishwasher (2h)", durationHours: 2 },
    { label: "Washing machine (2h)", durationHours: 2 },
  ]

  const lines = applianceRecommendations.map((appliance) => {
    const slots = getCheapestTimeWindows(data, appliance.durationHours, 1)
    if (!slots.length) return `- ${appliance.label}: No recommendation available`

    return `- ${appliance.label}: from ${formatHour(slots[0].start_timestamp)}`
  })

  return ["", "Recommended low-price start times:", ...lines].join("\n")
}

function formatSummary(data) {
  const average = getAverageCtPerKwh(data)
  const negativeHours = getNegativePriceHours(data)
  const cheapestHours = getCheapestHours(data, 5)
  const savingsHints = formatSavingsHints(data)

  const negativeLine = negativeHours.length
    ? `Yes (${negativeHours.length}h): ${negativeHours
        .map((item) => formatHourRange(item.start_timestamp, item.end_timestamp))
        .join(", ")}`
    : "No"

  const cheapestLines = cheapestHours
    .map((item) => {
      const priceCt = toCtPerKwh(item.marketprice).toFixed(2)
      return `${formatHourRange(item.start_timestamp, item.end_timestamp)} (${priceCt} ct/kWh)`
    })
    .join("\n")

  return [
    `Average price: ${average.toFixed(2)} ct/kWh`,
    `Negative prices: ${negativeLine}`,
    "",
    "5 cheapest hours:",
    cheapestLines,
    savingsHints,
  ].join("\n")
}

function formatDateLabel(data) {
  if (!data.length) return "today"
  const first = new Date(data[0].start_timestamp).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Vienna",
  })
  return first
}

async function sendMessage(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram send error: ${res.status} ${body}`)
  }
}

async function run() {
  assertEnv()
  const data = await getPrices()
  if (!data.length) throw new Error("No price data received")

  const message = `⚡ Here is the price overview for ${formatDateLabel(data)}:\n\n${formatSummary(data)}`
  await sendMessage(message)
  console.log("Telegram message sent.")
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
