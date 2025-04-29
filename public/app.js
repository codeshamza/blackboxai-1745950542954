// app.js - Fetch MEXC futures data, calculate indicators, generate signals, and render dashboard

const pairs = [
  "SOLUSDT","BTCUSDT","ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","SHIBUSDT",
  "DOTUSDT","ATOMUSDT","LTCUSDT","AVAXUSDT","LINKUSDT","TRXUSDT","NEARUSDT","APTUSDT",
  "BCHUSDT","FILUSDT","MATICUSDT","ETCUSDT","XLMUSDT","VETUSDT","THETAUSDT","RUNEUSDT",
  "FTMUSDT","SANDUSDT","MANAUSDT","AAVEUSDT","LDOUSDT","CRVUSDT","MKRUSDT","COMPUSDT",
  "UNIUSDT","APEUSDT","FLOKIUSDT","GRTUSDT","ALGOUSDT","ICPUSDT","HBARUSDT","EOSUSDT"
];

// Constants for calculations
const accountSize = 100000;
const riskPercentage = 1.0;

// Utility functions for indicator calculations

function logReturns(closes) {
  let result = [];
  for (let i = 1; i < closes.length; i++) {
    result.push(Math.log(closes[i] / closes[i - 1]));
  }
  return result;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

function rollingStdDev(arr, window) {
  let result = [];
  for (let i = 0; i <= arr.length - window; i++) {
    result.push(stdDev(arr.slice(i, i + window)));
  }
  return result;
}

function rollingMean(arr, window) {
  let result = [];
  for (let i = 0; i <= arr.length - window; i++) {
    result.push(mean(arr.slice(i, i + window)));
  }
  return result;
}

function sign(num) {
  if (num > 0) return 1;
  if (num < 0) return -1;
  return 0;
}

function ema(values, span) {
  const k = 2 / (span + 1);
  let emaArray = [];
  emaArray[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    emaArray[i] = values[i] * k + emaArray[i - 1] * (1 - k);
  }
  return emaArray;
}

function rsi(closes, period = 16) {
  let gains = [];
  let losses = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  let avgGain = mean(gains.slice(0, period));
  let avgLoss = mean(losses.slice(0, period));
  let rsis = [];
  rsis[period] = 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const gain = gains[i - 1];
    const loss = losses[i - 1];
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsis[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsis;
}

function macd(closes) {
  const ema12 = ema(closes, 14);
  const ema26 = ema(closes, 30);
  let macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    macdLine[i] = ema12[i] - ema26[i];
  }
  const signalLine = ema(macdLine, 10);
  return { macdLine, signalLine };
}

function bollingerBands(closes, period = 16) {
  const middle = rollingMean(closes, period);
  const std = rollingStdDev(closes, period);
  let upper = [];
  let lower = [];
  for (let i = 0; i < middle.length; i++) {
    upper[i] = middle[i] + 2 * std[i];
    lower[i] = middle[i] - 2 * std[i];
  }
  return { middle, upper, lower };
}

function bollingerBandWidth(upper, lower, middle) {
  let bbw = [];
  for (let i = 0; i < middle.length; i++) {
    bbw[i] = (upper[i] - lower[i]) / middle[i];
  }
  return bbw;
}

function vwap(highs, lows, closes, volumes) {
  let cumPV = 0;
  let cumVol = 0;
  let vwapArr = [];
  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typicalPrice * volumes[i];
    cumVol += volumes[i];
    vwapArr[i] = cumPV / cumVol;
  }
  return vwapArr;
}

function atr(highs, lows, closes, period = 16) {
  let trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  let atrs = rollingMean(trs, period);
  return atrs;
}

function skewness(arr) {
  const n = arr.length;
  const meanVal = mean(arr);
  const s = stdDev(arr);
  let sumCubed = 0;
  for (let i = 0; i < n; i++) {
    sumCubed += Math.pow((arr[i] - meanVal) / s, 3);
  }
  return (n / ((n - 1) * (n - 2))) * sumCubed;
}

function kurtosis(arr) {
  const n = arr.length;
  const meanVal = mean(arr);
  const s = stdDev(arr);
  let sumQuad = 0;
  for (let i = 0; i < n; i++) {
    sumQuad += Math.pow((arr[i] - meanVal) / s, 4);
  }
  return (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3)) * sumQuad - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
}

function jarqueBera(arr) {
  const n = arr.length;
  const s = skewness(arr);
  const k = kurtosis(arr);
  return (n / 6) * (s * s + (1 / 4) * Math.pow(k, 2));
}

function jarqueBeraTest(arr, window = 128) {
  // For simplicity, test last window only
  if (arr.length < window) return false;
  const sample = arr.slice(arr.length - window);
  const jbStat = jarqueBera(sample);
  // Approximate p-value threshold: jbStat > 6.635 means reject normality at 0.01 level
  // We want p-value < 0.05, so threshold ~3.84
  return jbStat > 3.84;
}

function signChange(arr, shift = 4) {
  if (arr.length < shift + 1) return 0;
  return sign(arr[arr.length - 1] - arr[arr.length - 1 - shift]);
}

async function fetchOHLCV(pair) {
  // Use local proxy server to bypass CORS
  const mexcPair = pair.slice(0, -4) + "_USDT";
  const url = `/api/kline?symbol=${mexcPair}&period=15m&limit=150`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.data && Array.isArray(data.data)) {
      // data.data is array of arrays: [timestamp, open, high, low, close, volume]
      return data.data.map(item => ({
        timestamp: item[0],
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      }));
    } else {
      console.error(`Failed to fetch data for ${pair}`, data);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching data for ${pair}`, error);
    return null;
  }
}

// Calculate signals and indicators for a pair
function calculateSignals(ohlcv) {
  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  const volumes = ohlcv.map(c => c.volume);

  // Log returns
  const logRets = logReturns(closes);

  // Realized volatility (16-candle rolling std dev of log returns scaled)
  const realizedVol = rollingStdDev(logRets, 16).map(v => v * Math.sqrt(252 * 24 * 4));

  // Volatility change over 4 candles
  const volChange = [];
  for (let i = 4; i < realizedVol.length; i++) {
    volChange.push(sign(realizedVol[i] - realizedVol[i - 4]));
  }

  // EMA fast and slow
  const emaFast = ema(closes, 16);
  const emaSlow = ema(closes, 37);

  // RSI 16
  const rsiArr = rsi(closes, 16);

  // MACD
  const { macdLine, signalLine } = macd(closes);

  // Bollinger Bands
  const { middle: bbMiddle, upper: bbUpper, lower: bbLower } = bollingerBands(closes, 16);
  const bbw = bollingerBandWidth(bbUpper, bbLower, bbMiddle);

  // VWAP
  const vwapArr = vwap(highs, lows, closes, volumes);

  // ATR 16
  const atrArr = atr(highs, lows, closes, 16);

  // Jarque-Bera statistic over 16-candle rolling window of log returns
  const jbStats = [];
  for (let i = 0; i <= logRets.length - 16; i++) {
    jbStats.push(jarqueBera(logRets.slice(i, i + 16)));
  }

  // JB change over 4 candles
  const jbChange = [];
  for (let i = 4; i < jbStats.length; i++) {
    jbChange.push(sign(jbStats[i] - jbStats[i - 4]));
  }

  // Latest candle index for aligned arrays
  const idx = closes.length - 1;
  const idxVolChange = volChange.length - 1;
  const idxJbChange = jbChange.length - 1;
  const idxRsi = rsiArr.length - 1;
  const idxMacd = macdLine.length - 1;
  const idxSignal = signalLine.length - 1;
  const idxBbw = bbw.length - 1;
  const idxVwap = vwapArr.length - 1;
  const idxAtr = atrArr.length - 1;
  const idxJbSafe = logRets.length - 128;

  // JB Safe test
  const jbSafe = jarqueBeraTest(logRets, 128);

  // Signal conditions
  const buySignal =
    jbSafe &&
    bbw[idxBbw] < 0.10 &&
    emaFast[idx] > emaSlow[idx] &&
    closes[idx] > vwapArr[idxVwap] &&
    rsiArr[idxRsi] < 67 &&
    macdLine[idxMacd] > signalLine[idxSignal] &&
    volChange[idxVolChange] !== -1 &&
    jbChange[idxJbChange] >= 0;

  const sellSignal =
    jbSafe &&
    bbw[idxBbw] < 0.10 &&
    emaFast[idx] < emaSlow[idx] &&
    closes[idx] < vwapArr[idxVwap] &&
    rsiArr[idxRsi] > 40 &&
    macdLine[idxMacd] < signalLine[idxSignal] &&
    volChange[idxVolChange] <= 0 &&
    jbChange[idxJbChange] <= 0;

  const action = buySignal ? "BUY" : sellSignal ? "SELL" : "WAIT";

  // Additional outputs
  const volatilityCompression = bbw[idxBbw] < 0.10;
  const trend = emaFast[idx] > emaSlow[idx] ? "UP" : "DOWN";
  const rsiVal = rsiArr[idxRsi] ? rsiArr[idxRsi].toFixed(2) : "N/A";
  const macdStatus =
    macdLine[idxMacd] > signalLine[idxSignal]
      ? "Bullish"
      : macdLine[idxMacd] < signalLine[idxSignal]
      ? "Bearish"
      : "Neutral";
  const vwapStatus = closes[idx] > vwapArr[idxVwap] ? "Above" : "Below";
  const volatilityChange =
    volChange[idxVolChange] > 0
      ? "Up"
      : volChange[idxVolChange] < 0
      ? "Down"
      : "Neutral";
  const jbChangeStatus =
    jbChange[idxJbChange] > 0
      ? "Up"
      : jbChange[idxJbChange] < 0
      ? "Down"
      : "Neutral";

  // Position size calculation
  const stopLossDistance = 2 * (atrArr[idxAtr] || 0);
  const riskAmount = (accountSize * riskPercentage) / 100;
  const positionSizeRaw = stopLossDistance > 0 ? (riskAmount / stopLossDistance) * closes[idx] : 0;
  const maxSize = (accountSize * 0.1) / closes[idx];
  const positionSize = Math.min(positionSizeRaw, maxSize).toFixed(2);

  return {
    action,
    jbSafe,
    volatilityCompression,
    trend,
    rsi: rsiVal,
    macdStatus,
    vwapStatus,
    volatilityChange,
    jbChangeStatus,
    positionSize,
  };
}

async function fetchCurrentPrice(pair) {
  // Use local proxy server to bypass CORS
  const mexcPair = pair.slice(0, -4) + "_USDT";
  const url = `/api/ticker?symbol=${mexcPair}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
      return parseFloat(data.data[0].last);
    } else {
      console.error(`Failed to fetch current price for ${pair}`, data);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching current price for ${pair}`, error);
    return null;
  }
}

// Render table rows with colors and current price, with unique IDs for each cell
function renderRow(pair, signals, currentPrice) {
  function colorForBool(val) {
    return val ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
  }
  function colorForStatus(status, positiveValues) {
    if (status === 'Neutral') return 'text-yellow-500 font-semibold';
    return positiveValues.includes(status) ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
  }
  return `
    <tr class="border-b hover:bg-gray-100" id="row-${pair}">
      <td class="px-4 py-2 font-semibold" id="pair-${pair}">${pair}</td>
      <td class="px-4 py-2 font-bold ${signals.action === "BUY" ? "text-green-700" : signals.action === "SELL" ? "text-red-700" : "text-yellow-500"}" id="action-${pair}">${signals.action}</td>
      <td class="px-4 py-2 ${colorForBool(signals.jbSafe)}" id="jbSafe-${pair}">${signals.jbSafe ? "✔️" : "❌"}</td>
      <td class="px-4 py-2 ${colorForBool(signals.volatilityCompression)}" id="volComp-${pair}">${signals.volatilityCompression ? "✔️" : "❌"}</td>
      <td class="px-4 py-2 ${signals.trend === 'UP' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}" id="trend-${pair}">${signals.trend}</td>
      <td class="px-4 py-2" id="rsi-${pair}">${signals.rsi}</td>
      <td class="px-4 py-2 ${colorForStatus(signals.macdStatus, ['Bullish'])}" id="macd-${pair}">${signals.macdStatus}</td>
      <td class="px-4 py-2 ${colorForStatus(signals.vwapStatus, ['Above'])}" id="vwap-${pair}">${signals.vwapStatus}</td>
      <td class="px-4 py-2 ${colorForStatus(signals.volatilityChange, ['Up'])}" id="volChange-${pair}">${signals.volatilityChange}</td>
      <td class="px-4 py-2 ${colorForStatus(signals.jbChangeStatus, ['Up'])}" id="jbChange-${pair}">${signals.jbChangeStatus}</td>
      <td class="px-4 py-2" id="posSize-${pair}">${signals.positionSize}</td>
      <td class="px-4 py-2 font-mono text-right" id="price-${pair}">${currentPrice !== null ? currentPrice.toFixed(4) : 'N/A'}</td>
    </tr>
  `;
}

// Update existing row cells with new data without reloading entire table
function updateRow(pair, signals, currentPrice, ping) {
  function colorForBool(val) {
    return val ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
  }
  function colorForStatus(status, positiveValues) {
    if (status === 'Neutral') return 'text-yellow-500 font-semibold';
    return positiveValues.includes(status) ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
  }

  const actionCell = document.getElementById(`action-${pair}`);
  if (actionCell) {
    actionCell.textContent = signals.action;
    actionCell.className = `px-4 py-2 font-bold ${
      signals.action === "BUY" ? "text-green-700" : signals.action === "SELL" ? "text-red-700" : "text-yellow-500"
    }`;
  }

  const jbSafeCell = document.getElementById(`jbSafe-${pair}`);
  if (jbSafeCell) {
    jbSafeCell.textContent = signals.jbSafe ? "✔️" : "❌";
    jbSafeCell.className = `px-4 py-2 ${colorForBool(signals.jbSafe)}`;
  }

  const volCompCell = document.getElementById(`volComp-${pair}`);
  if (volCompCell) {
    volCompCell.textContent = signals.volatilityCompression ? "✔️" : "❌";
    volCompCell.className = `px-4 py-2 ${colorForBool(signals.volatilityCompression)}`;
  }

  const trendCell = document.getElementById(`trend-${pair}`);
  if (trendCell) {
    trendCell.textContent = signals.trend;
    trendCell.className = `px-4 py-2 ${signals.trend === 'UP' ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}`;
  }

  const rsiCell = document.getElementById(`rsi-${pair}`);
  if (rsiCell) {
    rsiCell.textContent = signals.rsi;
  }

  const macdCell = document.getElementById(`macd-${pair}`);
  if (macdCell) {
    macdCell.textContent = signals.macdStatus;
    macdCell.className = `px-4 py-2 ${colorForStatus(signals.macdStatus, ['Bullish'])}`;
  }

  const vwapCell = document.getElementById(`vwap-${pair}`);
  if (vwapCell) {
    vwapCell.textContent = signals.vwapStatus;
    vwapCell.className = `px-4 py-2 ${colorForStatus(signals.vwapStatus, ['Above'])}`;
  }

  const volChangeCell = document.getElementById(`volChange-${pair}`);
  if (volChangeCell) {
    volChangeCell.textContent = signals.volatilityChange;
    volChangeCell.className = `px-4 py-2 ${colorForStatus(signals.volatilityChange, ['Up'])}`;
  }

  const jbChangeCell = document.getElementById(`jbChange-${pair}`);
  if (jbChangeCell) {
    jbChangeCell.textContent = signals.jbChangeStatus;
    jbChangeCell.className = `px-4 py-2 ${colorForStatus(signals.jbChangeStatus, ['Up'])}`;
  }

  const pingCell = document.getElementById(`posSize-${pair}`);
  if (pingCell) {
    pingCell.textContent = ping !== null ? ping.toFixed(0) : 'N/A';
  }

  const priceCell = document.getElementById(`price-${pair}`);
  if (priceCell) {
    priceCell.textContent = currentPrice !== null ? currentPrice.toFixed(4) : 'N/A';
  }
}

// Main function to fetch data and update dashboard
async function updateDashboard() {
  const tbody = document.getElementById("signal-tbody");
  const loading = document.getElementById("loading");

  tbody.innerHTML = "";
  loading.style.display = "flex";

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    try {
      const ohlcv = await fetchOHLCV(pair);
      if (!ohlcv) {
        console.warn(`No OHLCV data for ${pair}`);
        continue;
      }
      const signals = calculateSignals(ohlcv);
      const currentPrice = await fetchCurrentPrice(pair);
      tbody.innerHTML += renderRow(pair, signals, currentPrice);
    } catch (error) {
      console.error(`Error processing ${pair}:`, error);
    }
  }

  loading.style.display = "none";
  document.getElementById("signal-table").classList.remove("hidden");
};

window.onload = () => {
  updateDashboard(); // initial full update

  // Refresh entire table every 1 minute
  setInterval(() => {
    updateDashboard();
  }, 60000);
};

// Remove the second duplicate window.onload handler below to prevent multiple reloads
// The following duplicate window.onload handler should be removed:

// window.onload = () => {
//   updateDashboard();
// };

// Remove duplicate setInterval calling updateDashboard every 1 second
// Remove any other duplicate calls to updateDashboard intervals

// Main function to fetch data and update dashboard
async function updateDashboard() {
  const tbody = document.getElementById("signal-tbody");
  const loading = document.getElementById("loading");
  tbody.innerHTML = "";
  loading.style.display = "flex";

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    try {
      const ohlcv = await fetchOHLCV(pair);
      if (!ohlcv) {
        console.warn(`No OHLCV data for ${pair}`);
        continue;
      }
      const signals = calculateSignals(ohlcv);
      const currentPrice = await fetchCurrentPrice(pair);
      tbody.innerHTML += renderRow(pair, signals, currentPrice);
    } catch (error) {
      console.error(`Error processing ${pair}:`, error);
    }
  }

  loading.style.display = "none";
  document.getElementById("signal-table").classList.remove("hidden");
}

async function updateDashboard() {
  const tbody = document.getElementById("signal-tbody");
  const loading = document.getElementById("loading");
  tbody.innerHTML = "";
  loading.style.display = "flex";

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    try {
      const ohlcv = await fetchOHLCV(pair);
      if (!ohlcv) {
        console.warn(`No OHLCV data for ${pair}`);
        continue;
      }
      const signals = calculateSignals(ohlcv);
      const currentPrice = await fetchCurrentPrice(pair);
      tbody.innerHTML += renderRow(pair, signals, currentPrice);
    } catch (error) {
      console.error(`Error processing ${pair}:`, error);
    }
  }

  loading.style.display = "none";
  document.getElementById("signal-table").classList.remove("hidden");
}

// Run on page load and update every 1 minute
window.onload = () => {
  updateDashboard();
  setInterval(updateDashboard, 60000);
};
