#!/usr/bin/env node

const fs = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_CONFIG = "config.json";
const FUND_URL = "https://fund.eastmoney.com/pingzhongdata";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const configPath = getArgValue("--config") || process.env.FUND_CONFIG || DEFAULT_CONFIG;

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});

async function main() {
  const config = await readJson(configPath);
  validateConfig(config);

  const reports = await Promise.all(
    config.funds.map(async (fund) => {
      const nav = await fetchFundNav(fund.code);
      return buildFundReport(fund, nav);
    })
  );

  const message = formatMessage(reports);

  console.log(message);

  if (!dryRun) {
    await pushBark(resolveBarkConfig(config.bark), "基金收益日报", message);
    console.log("Bark push sent.");
  }
}

async function readJson(file) {
  const resolved = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw);
}

function validateConfig(config) {
  if (!config || !Array.isArray(config.funds) || config.funds.length === 0) {
    throw new Error("config.funds must be a non-empty array.");
  }

  for (const fund of config.funds) {
    if (!fund.code) throw new Error("Each fund must have a code.");
    if (!Array.isArray(fund.transactions)) {
      throw new Error(`Fund ${fund.code} must have transactions array.`);
    }
  }

  if (!dryRun && !process.env.BARK && (!config.bark || !config.bark.key)) {
    throw new Error("BARK env or bark.key is required when not running with --dry-run.");
  }
}

function resolveBarkConfig(bark = {}) {
  const envBark = (process.env.BARK || "").trim();

  if (!envBark) return bark;

  const isUrl = /^https?:\/\//i.test(envBark);
  if (!isUrl) {
    return { ...bark, key: envBark };
  }

  const parsed = new URL(envBark);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("BARK env URL must include Bark key, for example https://api.day.app/YOUR_KEY.");
  }

  return {
    ...bark,
    server: `${parsed.protocol}//${parsed.host}`,
    key: parts[0],
  };
}

async function fetchFundNav(code) {
  const text = await requestText(`${FUND_URL}/${encodeURIComponent(code)}.js`);
  const name = readJsString(text, "fS_name") || code;
  const fundCode = readJsString(text, "fS_code") || code;
  const netWorthTrend = readJsonVariable(text, "Data_netWorthTrend");

  if (!Array.isArray(netWorthTrend) || netWorthTrend.length < 2) {
    throw new Error(`No enough net worth data for fund ${code}.`);
  }

  const latest = netWorthTrend[netWorthTrend.length - 1];
  const previous = netWorthTrend[netWorthTrend.length - 2];

  return {
    code: fundCode,
    name,
    latestDate: formatDate(latest.x),
    latestNav: Number(latest.y),
    previousDate: formatDate(previous.x),
    previousNav: Number(previous.y),
    dailyReturnRate: Number(latest.equityReturn || 0),
  };
}

function readJsString(text, varName) {
  const match = text.match(new RegExp(`var\\s+${escapeRegExp(varName)}\\s*=\\s*"([^"]*)"`));
  return match ? decodeEscaped(match[1]) : "";
}

function readJsonVariable(text, varName) {
  const marker = `var ${varName} = `;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`Cannot find ${varName}.`);

  const jsonStart = start + marker.length;
  const end = findJsonEnd(text, jsonStart);
  return JSON.parse(text.slice(jsonStart, end));
}

function findJsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }

  throw new Error("Cannot parse fund net worth JSON.");
}

function buildFundReport(fund, nav) {
  const position = calculatePosition(fund.transactions);
  const marketValue = roundMoney(position.shares * nav.latestNav);
  const dailyIncome = roundMoney(position.shares * (nav.latestNav - nav.previousNav));
  const cumulativeIncome = roundMoney(
    marketValue + position.sellIncome + position.cashDividend - position.buyCost
  );
  const cumulativeRate =
    position.buyCost > 0 ? cumulativeIncome / position.buyCost : 0;

  return {
    code: fund.code,
    name: fund.alias || nav.name,
    nav,
    shares: position.shares,
    buyCost: position.buyCost,
    marketValue,
    dailyIncome,
    cumulativeIncome,
    cumulativeRate,
  };
}

function calculatePosition(transactions) {
  return transactions.reduce(
    (acc, tx) => {
      const type = String(tx.type || "").toLowerCase();
      const amount = numberOrZero(tx.amount);
      const shares = numberOrZero(tx.shares);
      const fee = numberOrZero(tx.fee);

      if (type === "buy") {
        acc.buyCost += amount + fee;
        acc.shares += shares;
      } else if (type === "sell") {
        acc.sellIncome += amount;
        acc.shares -= shares;
      } else if (type === "dividend") {
        acc.cashDividend += amount;
      } else if (type === "reinvest") {
        acc.shares += shares;
      } else {
        throw new Error(`Unsupported transaction type: ${tx.type}`);
      }

      return acc;
    },
    { shares: 0, buyCost: 0, sellIncome: 0, cashDividend: 0 }
  );
}

function summarize(reports) {
  const buyCost = sum(reports, "buyCost");
  const marketValue = sum(reports, "marketValue");
  const dailyIncome = sum(reports, "dailyIncome");
  const cumulativeIncome = sum(reports, "cumulativeIncome");
  const cumulativeRate = buyCost > 0 ? cumulativeIncome / buyCost : 0;

  return {
    buyCost: roundMoney(buyCost),
    marketValue: roundMoney(marketValue),
    dailyIncome: roundMoney(dailyIncome),
    cumulativeIncome: roundMoney(cumulativeIncome),
    cumulativeRate,
  };
}

function formatMessage(reports) {
  const lines = [];

  reports.forEach((report, index) => {
    if (index > 0) lines.push("");
    lines.push(`${report.name}（${report.code}）`);
    lines.push(`市值：${unsignedMoney(report.marketValue)}`);
    lines.push(`当日：${money(report.dailyIncome)}（${report.nav.latestDate}）`);
    if (report.code === "008143") {
      lines.push(`净值：${formatNumber(report.nav.latestNav, 4)}`);
    }
    lines.push(`累计：${money(report.cumulativeIncome)}`);
    lines.push(`累计收益率：${percent(report.cumulativeRate)}`);
  });

  return lines.join("\n");
}

async function pushBark(bark, title, body) {
  const base = (bark.server || "https://api.day.app").replace(/\/+$/, "");
  const url = new URL(`${base}/${encodeURIComponent(bark.key)}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`);

  const optionalFields = ["sound", "group", "icon", "level", "url"];
  for (const field of optionalFields) {
    if (bark[field]) url.searchParams.set(field, bark[field]);
  }

  const response = await requestJson(url.toString());
  if (response.code !== 200) {
    throw new Error(`Bark push failed: ${JSON.stringify(response)}`);
  }
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "fund-income-bark/1.0" } }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${url}: ${data.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function requestJson(url) {
  const text = await requestText(url);
  return JSON.parse(text);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(timestamp))
    .replaceAll("/", "-");
}

function formatNow() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replaceAll("/", "-");
}

function money(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${roundMoney(value).toFixed(2)} 元`;
}

function unsignedMoney(value) {
  return `${roundMoney(value).toFixed(2)} 元`;
}

function percent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function sum(items, field) {
  return items.reduce((total, item) => total + numberOrZero(item[field]), 0);
}

function decodeEscaped(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}
