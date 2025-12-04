"use strict";

// ===================== 环境与常量配置（FlClash 适配）=====================
const PLATFORM = Object.freeze({
  isNode: typeof process !== "undefined" && !!process.versions?.node,
  isBrowser: typeof window !== "undefined" && typeof window.addEventListener === "function",
  isFlClash: typeof $flclash !== "undefined" // FlClash 环境标识
});

const CONSTANTS = Object.freeze({
  // 节点配置
  PREHEAT_NODE_COUNT: 10,
  NODE_TEST_TIMEOUT: 5000,
  MAX_HISTORY_RECORDS: 100,
  NODE_EVALUATION_THRESHOLD: 3 * 60 * 60 * 1000,
  NODE_CLEANUP_THRESHOLD: 20,
  
  // 缓存配置（FlClash 持久化适配）
  LRU_CACHE_MAX_SIZE: 1000,
  LRU_CACHE_TTL: 3600000,
  CACHE_CLEANUP_THRESHOLD: 0.1,
  CACHE_CLEANUP_BATCH_SIZE: 50,
  
  // 并发/重试配置
  CONCURRENCY_LIMIT: 3,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_BASE: 200,
  MAX_RETRY_BACKOFF_MS: 5000,
  
  // 评分配置
  QUALITY_SCORE_THRESHOLD: 30,
  QUALITY_WEIGHT: 0.5,
  METRIC_WEIGHT: 0.35,
  SUCCESS_WEIGHT: 0.15,
  
  // 可用性配置
  AVAILABILITY_MIN_RATE: 0.75,
  AVAILABILITY_EMERGENCY_FAILS: 2,
  
  // 网络指标配置
  LATENCY_CLAMP_MS: 3000,
  JITTER_CLAMP_MS: 500,
  LOSS_CLAMP: 1.0,
  THROUGHPUT_SOFT_CAP_BPS: 50_000_000,
  THROUGHPUT_SCORE_MAX: 15,
  LARGE_PAYLOAD_THRESHOLD_BYTES: 512 * 1024,
  
  // 切换冷却配置
  BASE_SWITCH_COOLDOWN: 30 * 60 * 1000,
  MIN_SWITCH_COOLDOWN: 5 * 60 * 1000,
  MAX_SWITCH_COOLDOWN: 2 * 60 * 60 * 1000,
  
  // 偏置系数
  BIAS_AVAIL_BONUS_OK: 10,
  BIAS_AVAIL_PENALTY_BAD: -30,
  BIAS_LATENCY_MAX_BONUS: 15,
  BIAS_JITTER_MAX_PENALTY: 10,
  
  // 正则/端口配置（FlClash 常用服务适配）
  STREAM_HINT_REGEX: /youtube|netflix|stream|video|live|hls|dash/i,
  AI_HINT_REGEX: /openai|claude|gemini|ai|chatgpt|api\.openai|anthropic|googleapis/i,
  GAMING_PORTS: [3074, 27015, 27016, 27017, 27031, 27036, 5000, 5001],
  TLS_PORTS: [443, 8443],
  HTTP_PORTS: [80, 8080, 8880],
  
  // 其他配置
  GEO_INFO_TIMEOUT: 3000,
  GEO_FALLBACK_TTL: 3600000,
  FEATURE_WINDOW_SIZE: 50,
  MIN_SAMPLE_SIZE: 5,
  ENABLE_SCORE_DEBUGGING: false,
  DEFAULT_USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  FLCLASH_STORAGE_KEY: "flclash_central_data" // FlClash 存储键
});

// ===================== 基础工具（FlClash 兼容）=====================
const Logger = {
  error: (...args) => $flclash?.logError?.(...args) || console.error("[FlClash-ERROR]", ...args),
  info: (...args) => $flclash?.logInfo?.(...args) || console.info("[FlClash-INFO]", ...args),
  debug: (...args) => CONSTANTS.ENABLE_SCORE_DEBUGGING && ($flclash?.logDebug?.(...args) || console.debug("[FlClash-DEBUG]", ...args)),
  warn: (...args) => $flclash?.logWarn?.(...args) || console.warn("[FlClash-WARN]", ...args)
};

class CustomError extends Error {
  constructor(message, name) {
    super(message);
    this.name = name;
  }
}

class ConfigurationError extends CustomError {
  constructor(message) {
    super(message, "ConfigurationError");
  }
}

class InvalidRequestError extends CustomError {
  constructor(message) {
    super(message, "InvalidRequestError");
  }
}

// ===================== 事件系统（FlClash 事件适配）=====================
class EventEmitter {
  constructor() {
    this.eventListeners = new Map();
    // 注册 FlClash 原生事件监听
    if (PLATFORM.isFlClash && $flclash?.on) {
      $flclash.on("configChanged", () => this.emit("configChanged"));
      $flclash.on("networkOnline", () => this.emit("networkOnline"));
    }
  }

  on(event, listener) {
    if (!event || typeof listener !== "function") return;
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  off(event, listener) {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    index !== -1 && listeners.splice(index, 1);
    listeners.length === 0 && this.eventListeners.delete(event);
  }

  emit(event, ...args) {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    [...listeners].forEach(fn => {
      try { fn(...args); } catch (e) { Logger.error(`事件 ${event} 处理失败:`, e.stack || e); }
    });
  }

  removeAllListeners(event) {
    event ? this.eventListeners.delete(event) : this.eventListeners.clear();
  }
}

// ===================== 数据存储（FlClash 持久化适配）=====================
class AppState {
  constructor() {
    this.nodes = new Map(); // 节点状态
    this.metrics = new Map(); // 指标数据
    this.config = PLATFORM.isFlClash ? $flclash.config || {} : {}; // 读取 FlClash 配置
    this.lastUpdated = Date.now();
  }

  updateNodeStatus(nodeId, status) {
    if (typeof nodeId !== "string") return;
    const prevStatus = this.nodes.get(nodeId) || {};
    this.nodes.set(nodeId, { ...prevStatus, ...status });
    this.lastUpdated = Date.now();
    // FlClash 状态同步
    PLATFORM.isFlClash && $flclash?.setNodeStatus?.(nodeId, { ...prevStatus, ...status });
  }
}

class LRUCache {
  constructor({ maxSize = CONSTANTS.LRU_CACHE_MAX_SIZE, ttl = CONSTANTS.LRU_CACHE_TTL } = {}) {
    this.cache = new Map();
    this.maxSize = Math.max(1, Number(maxSize) || CONSTANTS.LRU_CACHE_MAX_SIZE);
    this.ttl = Math.max(1, Number(ttl) || CONSTANTS.LRU_CACHE_TTL);
    this.head = { key: null, prev: null, next: null };
    this.tail = { key: null, prev: this.head, next: null };
    this.head.next = this.tail;
    // FlClash 持久化缓存加载
    if (PLATFORM.isFlClash) this._loadFromFlClashStorage();
  }

  // 从 FlClash 存储加载缓存
  _loadFromFlClashStorage() {
    try {
      const stored = $flclash?.getStorage?.(CONSTANTS.FLCLASH_STORAGE_KEY) || "{}";
      const data = JSON.parse(stored);
      if (data.cache) {
        Object.entries(data.cache).forEach(([key, entry]) => {
          this.cache.set(key, entry);
          this._pushFront(entry);
        });
      }
    } catch (e) {
      Logger.warn("FlClash 缓存加载失败:", e.message);
    }
  }

  // 保存缓存到 FlClash 存储
  _saveToFlClashStorage() {
    if (!PLATFORM.isFlClash) return;
    try {
      const data = { cache: Object.fromEntries(this.cache) };
      $flclash?.setStorage?.(CONSTANTS.FLCLASH_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      Logger.warn("FlClash 缓存保存失败:", e.message);
    }
  }

  _unlink(node) {
    if (!node || node === this.head || node === this.tail) return;
    node.prev.next = node.next;
    node.next.prev = node.prev;
    node.prev = node.next = null;
  }

  _pushFront(node) {
    if (!node) return;
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  _evictTail() {
    const node = this.tail.prev;
    if (node === this.head) return null;
    this._unlink(node);
    this.cache.delete(node.key);
    this._saveToFlClashStorage();
    return node.key;
  }

  _cleanupExpiredEntries(limit = 100) {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > entry.ttl) {
        this._unlink(entry);
        this.cache.delete(key);
        if (++cleaned >= limit) break;
      }
    }
    cleaned > 0 && this._saveToFlClashStorage();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this._unlink(entry);
      this.cache.delete(key);
      this._saveToFlClashStorage();
      return null;
    }
    this._unlink(entry);
    entry.timestamp = Date.now();
    this._pushFront(entry);
    this._saveToFlClashStorage();
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    if (key == null) return;
    if (this.cache.size / this.maxSize > CONSTANTS.CACHE_CLEANUP_THRESHOLD) {
      this._cleanupExpiredEntries(CONSTANTS.CACHE_CLEANUP_BATCH_SIZE);
    }
    const now = Date.now();
    ttl = Math.max(1, ttl | 0);
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      entry.value = value;
      entry.ttl = ttl;
      entry.timestamp = now;
      this._unlink(entry);
      this._pushFront(entry);
    } else {
      if (this.cache.size >= this.maxSize) this._evictTail();
      const newNode = { key, value, ttl, timestamp: now, prev: null, next: null };
      this._pushFront(newNode);
      this.cache.set(key, newNode);
    }
    this._saveToFlClashStorage();
  }

  clear() {
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this._saveToFlClashStorage();
  }

  delete(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this._unlink(entry);
    this.cache.delete(key);
    this._saveToFlClashStorage();
    return true;
  }
}

// ===================== 统计工具 =====================
class RollingStats {
  constructor(windowSize = 100) {
    this.windowSize = Math.max(1, windowSize | 0);
    this.data = new Array(this.windowSize).fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
  }

  add(value) {
    const v = Number(value) || 0;
    if (this.count < this.windowSize) {
      this.data[this.index] = v;
      this.sum += v;
      this.count++;
    } else {
      this.sum += v - this.data[this.index];
      this.data[this.index] = v;
    }
    this.index = (this.index + 1) % this.windowSize;
  }

  get average() {
    return this.count ? this.sum / this.count : 0;
  }

  reset() {
    this.data.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
  }
}

class SuccessRateTracker {
  constructor() {
    this.successCount = 0;
    this.totalCount = 0;
    this.hardFailStreak = 0;
  }

  record(success, { hardFail = false } = {}) {
    this.totalCount++;
    if (success) {
      this.successCount++;
      this.hardFailStreak = 0;
    } else if (hardFail) {
      this.hardFailStreak++;
    }
  }

  get rate() {
    return this.totalCount ? this.successCount / this.totalCount : 0;
  }

  reset() {
    this.successCount = 0;
    this.totalCount = 0;
    this.hardFailStreak = 0;
  }
}

// ===================== 通用工具函数（FlClash 适配）=====================
const Utils = {
  sleep: (ms = 0) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms | 0))),

  async retry(fn, attempts = CONSTANTS.MAX_RETRY_ATTEMPTS, delay = CONSTANTS.RETRY_DELAY_BASE) {
    if (typeof fn !== "function") throw new Error("retry: 第一个参数必须是函数");
    const maxAttempts = Math.max(1, Math.min(10, Math.floor(attempts) || 3));
    const baseDelay = Math.max(0, Math.min(CONSTANTS.MAX_RETRY_BACKOFF_MS, Math.floor(delay) || 200));
    let lastError;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        if (i < maxAttempts - 1) {
          await this.sleep(Math.min(CONSTANTS.MAX_RETRY_BACKOFF_MS, baseDelay * Math.pow(2, i)));
        }
      }
    }
    throw lastError || new Error("retry: 所有重试都失败");
  },

  async asyncPool(tasks, concurrency = CONSTANTS.CONCURRENCY_LIMIT) {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const limit = Math.max(1, Math.min(50, Math.floor(concurrency) || 3));
    const results = [];
    let index = 0;

    const next = async () => {
      while (true) {
        const currentIndex = index++;
        if (currentIndex >= tasks.length) break;
        const task = tasks[currentIndex];
        try {
          const result = typeof task === "function" ? await task() : task;
          results[currentIndex] = { status: "fulfilled", value: result };
        } catch (e) {
          results[currentIndex] = { status: "rejected", reason: e };
        }
      }
    };

    await Promise.all(Array(limit).fill(0).map(next));
    return results.map(r => r.status === "fulfilled" ? r.value : { __error: r.reason });
  },

  calculateWeightedAverage: (values, weightFactor = 0.9) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    let sum = 0, weightSum = 0;
    values.forEach((val, idx) => {
      const weight = Math.pow(weightFactor, values.length - idx - 1);
      sum += val * weight;
      weightSum += weight;
    });
    return weightSum ? sum / weightSum : 0;
  },

  calculateStdDev: (values) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length);
  },

  calculateTrend: (values) => {
    const n = values.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumW = 0;
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / n;
      sumW += w;
      sumX += i * w;
      sumY += values[i] * w;
      sumXY += i * values[i] * w;
      sumX2 += i * i * w;
    }
    const numerator = sumW * sumXY - sumX * sumY;
    const denominator = sumW * sumX2 - sumX * sumX;
    return denominator ? numerator / denominator : 0;
  },

  calculatePercentile: (values, percentile) => {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    if (Math.floor(index) === index) return sorted[index];
    const i = Math.floor(index);
    return sorted[i] + (sorted[i + 1] - sorted[i]) * (index - i);
  },

  isValidDomain: (domain) => {
    return typeof domain === "string" &&
      /^[a-zA-Z0-9.-]+$/.test(domain) &&
      !domain.startsWith(".") &&
      !domain.endsWith(".") &&
      !domain.includes("..");
  },

  isIPv4: (ip) => {
    return typeof ip === "string" && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  },

  isPrivateIP: (ip) => {
    if (!this.isIPv4(ip)) return false;
    const parts = ip.split(".").map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  },

  // FlClash 区域代理筛选
  filterProxiesByRegion: (proxies, region) => {
    if (!Array.isArray(proxies) || !region?.regex) return [];
    return proxies
      .filter(p => {
        if (!p?.name) return false;
        const match = p.name.match(/(?:[xX✕✖⨉]|倍率)(\d+\.?\d*)/i);
        const multiplier = match ? parseFloat(match[1]) : 0;
        return region.regex.test(p.name) && multiplier <= (Config.regionOptions?.ratioLimit || 2);
      })
      .map(p => p.name);
  },

  // FlClash 服务组创建
  createServiceGroups: (config, regionGroupNames, ruleProviders, rules) => {
    if (!config || !Array.isArray(regionGroupNames) || !(ruleProviders instanceof Map) || !Array.isArray(rules)) return;
    Config.services.forEach(service => {
      if (!Config.ruleOptions[service.id]) return;
      if (Array.isArray(service.rule)) rules.push(...service.rule);
      if (service.ruleProvider) {
        ruleProviders.set(service.ruleProvider.name, {
          ...Config.common.ruleProvider,
          behavior: service.ruleProvider.behavior || "classical",
          format: service.ruleProvider.format || "text",
          url: service.ruleProvider.url,
          path: `./ruleset/${service.ruleProvider.name.split('-')[0]}/${service.ruleProvider.name}.${service.ruleProvider.format || 'list'}`
        });
      }
      const proxies = service.proxies || ["默认节点", ...(service.proxiesOrder || []), ...regionGroupNames, "直连"];
      config["proxy-groups"].push({
        ...Config.common.proxyGroup,
        name: service.name,
        type: "select",
        proxies,
        url: service.url || Config.common.proxyGroup.url,
        icon: service.icon
      });
    });
  }
};

// ===================== GitHub 镜像加速（FlClash 资源适配）=====================
const GH_MIRRORS = [
  "https://mirror.ghproxy.com/",
  "https://github.moeyy.xyz/",
  "https://ghproxy.com/",
  "" // 原始GitHub（回退）
];

const GH_TEST_TARGETS = [
  "https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore",
  "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/main/README.md",
  "https://raw.githubusercontent.com/cli/cli/trunk/README.md"
];

let GH_PROXY_PREFIX = "";
let __ghSelected = null;
let __ghLastProbeTs = 0;
const __GH_PROBE_TTL = 10 * 60 * 1000;
let __ghSelectLock = Promise.resolve();

const GH_RAW_URL = (path) => `${GH_PROXY_PREFIX}https://raw.githubusercontent.com/${path}`;
const GH_RELEASE_URL = (path) => `${GH_PROXY_PREFIX}https://github.com/${path}`;

const pickTestTarget = () => GH_TEST_TARGETS[Math.floor(Math.random() * GH_TEST_TARGETS.length)];

const makeTimedFetcher = (runtimeFetch, timeoutMs) => async (url, opts = {}) => {
  if (!timeoutMs) return runtimeFetch(url, opts);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    return await runtimeFetch(url, { ...opts, signal: controller?.signal });
  } finally {
    clearTimeout(timer);
  }
};

const __probeMirror = async (prefix, fetchFn) => {
  const testUrl = prefix ? `${prefix}${pickTestTarget()}` : pickTestTarget();
  try {
    const response = await fetchFn(testUrl, {
      method: "GET",
      headers: { "User-Agent": CONSTANTS.DEFAULT_USER_AGENT }
    }, CONSTANTS.GEO_INFO_TIMEOUT);
    return response.ok;
  } catch {
    return false;
  }
};

const selectBestMirror = async (runtimeFetch) => {
  const now = Date.now();
  if (__ghSelected && now - __ghLastProbeTs < __GH_PROBE_TTL) return __ghSelected;
  __ghSelectLock = __ghSelectLock.then(async () => {
    const timedFetch = makeTimedFetcher(runtimeFetch, CONSTANTS.GEO_INFO_TIMEOUT);
    const results = await Promise.all(GH_MIRRORS.map(m => __probeMirror(m, timedFetch).catch(() => false)));
    const healthyMirrors = GH_MIRRORS.filter((_, idx) => results[idx]);
    const chosen = healthyMirrors.length ? (healthyMirrors.includes("") ? "" : healthyMirrors[0]) : (__ghSelected || GH_MIRRORS[0]);
    __ghSelected = chosen;
    __ghLastProbeTs = now;
    GH_PROXY_PREFIX = chosen;
    return chosen;
  }).catch(e => {
    Logger.warn("GitHub镜像选择失败:", e.message);
    return __ghSelected || "";
  });
  return __ghSelectLock;
};

// ===================== FlClash 专用配置 =====================
const Config = {
  enable: true,
  privacy: { geoExternalLookup: true },
  ruleOptions: {
    apple: true, microsoft: true, github: true, google: true, openai: true, spotify: true,
    youtube: true, bahamut: true, netflix: true, tiktok: true, disney: true, pixiv: true,
    hbo: true, biliintl: true, tvb: true, hulu: true, primevideo: true, telegram: true,
    line: true, whatsapp: true, games: true, japan: true, tracker: true, ads: true
  },
  preRules: [
    "RULE-SET,applications,下载软件",
    "PROCESS-NAME,SunloginClient,DIRECT",
    "PROCESS-NAME,SunloginClient.exe,DIRECT",
    "PROCESS-NAME,AnyDesk,DIRECT",
    "PROCESS-NAME,AnyDesk.exe,DIRECT"
  ],
  regionOptions: {
    excludeHighPercentage: true, ratioLimit: 2,
    regions: [
      { name: "HK香港", regex: /港|🇭🇰|hk|hongkong|hong kong/i, icon: "HongKong" },
      { name: "US美国", regex: /美|🇺🇸|us|united state|america/i, icon: "UnitedStates" },
      { name: "JP日本", regex: /日本|🇯🇵|jp|japan/i, icon: "Japan" },
      { name: "KR韩国", regex: /韩|🇰🇷|kr|korea/i, icon: "Korea" },
      { name: "SG新加坡", regex: /新加坡|🇸🇬|sg|singapore/i, icon: "Singapore" },
      { name: "CN中国大陆", regex: /中国|🇨🇳|cn|china/i, icon: "ChinaMap" },
      { name: "TW台湾省", regex: /台湾|🇹🇼|tw|taiwan|tai wan/i, icon: "China" },
      { name: "GB英国", regex: /英|🇬🇧|uk|united kingdom|great britain/i, icon: "UnitedKingdom" },
      { name: "DE德国", regex: /德国|🇩🇪|de|germany/i, icon: "Germany" },
      { name: "MY马来西亚", regex: /马来|my|malaysia/i, icon: "Malaysia" },
      { name: "TK土耳其", regex: /土耳其|🇹🇷|tk|turkey/i, icon: "Turkey" }
    ]
  },
  dns: {
    enable: true, listen: ":1053", ipv6: true, "prefer-h3": true, "use-hosts": true, "use-system-hosts": true,
    "respect-rules": true, "enhanced-mode": "fake-ip", "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter": ["*", "+.lan", "+.local", "+.market.xiaomi.com"],
    nameserver: ["https://120.53.53.53/dns-query", "https://223.5.5.5/dns-query"],
    "proxy-server-nameserver": ["https://120.53.53.53/dns-query", "https://223.5.5.5/dns-query"],
    "nameserver-policy": { "geosite:private": "system", "geosite:cn,steam@cn,category-games@cn,microsoft@cn,apple@cn": ["119.29.29.29", "223.5.5.5"] }
  },
  services: [
    { id: "openai", rule: ["DOMAIN-SUFFIX,grazie.ai,国外AI", "DOMAIN-SUFFIX,grazie.aws.intellij.net,国外AI", "RULE-SET,ai,国外AI"], name: "国外AI", url: "https://chat.openai.com/cdn-cgi/trace", icon: "ChatGPT", ruleProvider: {name: "ai", url: GH_RAW_URL("dahaha-365/YaNet/dist/rulesets/mihomo/ai.list")} },
    { id: "youtube", rule: ["GEOSITE,youtube,YouTube"], name: "YouTube", url: "https://www.youtube.com/s/desktop/494dd881/img/favicon.ico", icon: "YouTube" },
    { id: "biliintl", rule: ["GEOSITE,biliintl,哔哩哔哩东南亚"], name: "哔哩哔哩东南亚", url: "https://www.bilibili.tv/", icon: "Bilibili3", proxiesOrder: ["默认节点", "直连"] },
    { id: "bahamut", rule: ["GEOSITE,bahamut,巴哈姆特"], name: "巴哈姆特", url: "https://ani.gamer.com.tw/ajax/getdeviceid.php", icon: "Bahamut", proxiesOrder: ["默认节点", "直连"] },
    { id: "disney", rule: ["GEOSITE,disney,Disney+"], name: "Disney+", url: "https://disney.api.edge.bamgrid.com/devices", icon: "DisneyPlus" },
    { id: "netflix", rule: ["GEOSITE,netflix,NETFLIX"], name: "NETFLIX", url: "https://api.fast.com/netflix/speedtest/v2?https=true", icon: "Netflix" },
    { id: "tiktok", rule: ["GEOSITE,tiktok,Tiktok"], name: "Tiktok", url: "https://www.tiktok.com/", icon: "TikTok" },
    { id: "spotify", rule: ["GEOSITE,spotify,Spotify"], name: "Spotify", url: "http://spclient.wg.spotify.com/signup/public/v1/account", icon: "Spotify" },
    { id: "pixiv", rule: ["GEOSITE,pixiv,Pixiv"], name: "Pixiv", url: "https://www.pixiv.net/favicon.ico", icon: "Pixiv" },
    { id: "hbo", rule: ["GEOSITE,hbo,HBO"], name: "HBO", url: "https://www.hbo.com/favicon.ico", icon: "HBO" },
    { id: "tvb", rule: ["GEOSITE,tvb,TVB"], name: "TVB", url: "https://www.tvb.com/logo_b.svg", icon: "TVB" },
    { id: "primevideo", rule: ["GEOSITE,primevideo,Prime Video"], name: "Prime Video", url: "https://m.media-amazon.com/images/G/01/digital/video/web/logo-min-remaster.png", icon: "PrimeVideo" },
    { id: "hulu", rule: ["GEOSITE,hulu,Hulu"], name: "Hulu", url: "https://auth.hulu.com/v4/web/password/authenticate", icon: "Hulu" },
    { id: "telegram", rule: ["GEOIP,telegram,Telegram"], name: "Telegram", url: "http://www.telegram.org/img/website_icon.svg", icon: "Telegram" },
    { id: "whatsapp", rule: ["GEOSITE,whatsapp,WhatsApp"], name: "WhatsApp", url: "https://web.whatsapp.com/data/manifest.json", icon: "Telegram" },
    { id: "line", rule: ["GEOSITE,line,Line"], name: "Line", url: "https://line.me/page-data/app-data.json", icon: "Line" },
    { id: "games", rule: ["GEOSITE,category-games@cn,国内网站", "GEOSITE,category-games,游戏专用"], name: "游戏专用", icon: "Game" },
    { id: "tracker", rule: ["GEOSITE,tracker,跟踪分析"], name: "跟踪分析", icon: "Reject", proxies: ["REJECT", "直连", "默认节点"] },
    { id: "ads", rule: ["GEOSITE,category-ads-all,广告过滤", "RULE-SET,adblockmihomo,广告过滤"], name: "广告过滤", icon: "Advertising", proxies: ["REJECT", "直连", "默认节点"], ruleProvider: {name: "adblockmihomo", url: GH_RAW_URL("217heidai/adblockfilters/main/rules/adblockmihomo.mrs"), format: "mrs", behavior: "domain"} },
    { id: "apple", rule: ["GEOSITE,apple-cn,苹果服务"], name: "苹果服务", url: "http://www.apple.com/library/test/success.html", icon: "Apple2" },
    { id: "google", rule: ["GEOSITE,google,谷歌服务"], name: "谷歌服务", url: "http://www.google.com/generate_204", icon: "GoogleSearch" },
    { id: "microsoft", rule: ["GEOSITE,microsoft@cn,国内网站", "GEOSITE,microsoft,微软服务"], name: "微软服务", url: "http://www.msftconnecttest.com/connecttest.txt", icon: "Microsoft" },
    { id: "github", rule: ["GEOSITE,github,Github"], name: "Github", url: "https://github.com/robots.txt", icon: "GitHub" },
    { id: "japan", rule: ["RULE-SET,category-bank-jp,日本网站", "GEOIP,jp,日本网站,no-resolve"], name: "日本网站", url: "https://r.r10s.jp/com/img/home/logo/touch.png", icon: "JP", ruleProvider: {name: "category-bank-jp", url: GH_RAW_URL("MetaCubeX/meta-rules-dat/meta/geo/geosite/category-bank-jp.mrs"), format: "mrs", behavior: "domain"} }
  ],
  system: {
    "allow-lan": true, "bind-address": "*", mode: "rule",
    profile: { "store-selected": true, "store-fake-ip": true },
    "unified-delay": true, "tcp-concurrent": true, "keep-alive-interval": 1800,
    "find-process-mode": "strict", "geodata-mode": true, "geodata-loader": "memconservative",
    "geo-auto-update": true, "geo-update-interval": 24,
    sniffer: {
      enable: true, "force-dns-mapping": true, "parse-pure-ip": false, "override-destination": true,
      sniff: { TLS: { ports: [443, 8443] }, HTTP: { ports: [80, "8080-8880"] }, QUIC: { ports: [443, 8443] } },
      "skip-src-address": ["1127.0.0.0/8", "192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"],
      "force-domain": ["+.google.com", "+.googleapis.com", "+.googleusercontent.com", "+.youtube.com", "+.facebook.com", "+.messenger.com", "+.fbcdn.net", "fbcdn-a.akamaihd.net"],
      "skip-domain": ["Mijia Cloud", "+.oray.com"]
    },
    ntp: { enable: true, "write-to-system": false, server: "cn.ntp.org.cn" },
    "geox-url": {
      geoip: GH_RELEASE_URL("MetaCubeX/meta-rules-dat/releases/download/latest/geoip-lite.dat"),
      geosite: GH_RELEASE_URL("MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"),
      mmdb: GH_RELEASE_URL("MetaCubeX/meta-rules-dat/releases/download/latest/country-lite.mmdb"),
      asn: GH_RELEASE_URL("MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb")
    }
  },
  common: {
    ruleProvider: { type: "http", format: "yaml", interval: 86400 },
    proxyGroup: { interval: 300, timeout: 3000, url: "http://cp.cloudflare.com/generate_204", lazy: true, "max-failed-times": 3, hidden: false },
    defaultProxyGroups: [
      { name: "下载软件", icon: "Download", proxies: ["直连", "REJECT", "默认节点", "国内网站"] },
      { name: "其他外网", icon: "StreamingNotCN", proxies: ["默认节点", "国内网站"] },
      { name: "国内网站", url: "http://wifi.vivo.com.cn/generate_204", icon: "StreamingCN", proxies: ["直连", "默认节点"] }
    ],
    postRules: ["GEOSITE,private,DIRECT", "GEOIP,private,DIRECT,no-resolve", "GEOSITE,cn,国内网站", "GEOIP,cn,国内网站,no-resolve", "MATCH,其他外网"]
  }
};

// ===================== 核心管理类（FlClash 适配）=====================
class MetricsManager {
  constructor(state) {
    this.state = state;
  }

  append(nodeId, metrics) {
    if (!nodeId) return;
    const metricsList = this.state.metrics.get(nodeId) || [];
    metricsList.push(metrics);
    if (metricsList.length > CONSTANTS.FEATURE_WINDOW_SIZE) {
      this.state.metrics.set(nodeId, metricsList.slice(-CONSTANTS.FEATURE_WINDOW_SIZE));
    } else {
      this.state.metrics.set(nodeId, metricsList);
    }
    // FlClash 指标同步
    PLATFORM.isFlClash && $flclash?.setNodeMetrics?.(nodeId, metrics);
  }
}

class AvailabilityTracker {
  constructor(state, nodeManager) {
    this.state = state;
    this.nodeManager = nodeManager;
    this.trackers = nodeManager.nodeSuccess;
  }

  ensure(nodeId) {
    if (!this.trackers.get(nodeId)) {
      this.trackers.set(nodeId, new SuccessRateTracker());
    }
  }

  record(nodeId, success, opts = {}) {
    this.ensure(nodeId);
    const tracker = this.trackers.get(nodeId);
    tracker.record(success, opts);
    const rate = tracker.rate;
    this.state.updateNodeStatus(nodeId, { availabilityRate: rate });
  }

  rate(nodeId) {
    return this.trackers.get(nodeId)?.rate || 0;
  }

  hardFailStreak(nodeId) {
    return this.trackers.get(nodeId)?.hardFailStreak || 0;
  }
}

class ThroughputEstimator {
  async tcpConnectLatency(host, port, timeout) {
    if (!PLATFORM.isNode) throw new Error("仅支持Node环境");
    const net = require("net");
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const socket = new net.Socket();
      let completed = false;

      const cleanup = (error) => {
        if (completed) return;
        completed = true;
        socket.destroy();
        error ? reject(error) : resolve(Date.now() - start);
      };

      socket.setTimeout(timeout, () => cleanup(new Error("TCP连接超时")));
      socket.once("error", cleanup);
      socket.connect(port, host, cleanup);
    });
  }

  async measureResponse(response) {
    let bytes = 0;
    let jitter = 0;
    try {
      if (response?.body?.getReader) {
        const reader = response.body.getReader();
        const maxBytes = 64 * 1024;
        const startTime = Date.now();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            bytes += value.byteLength || value.length || 0;
            if (bytes >= maxBytes) break;
          }
        }
        const duration = Math.max(1, Date.now() - startTime);
        const speedKbps = (bytes * 8) / duration;
        jitter = Math.min(CONSTANTS.JITTER_CLAMP_MS, Math.max(1, 200 - Math.round(speedKbps / 10)));
      } else if (response?.headers?.get) {
        bytes = parseInt(response.headers.get("Content-Length") || "0", 10);
      }
    } catch {}
    return { bytes, jitter };
  }

  bpsFromBytesLatency({ bytes = 0, latency = 0 }) {
    const ms = Math.max(1, Number(latency) || 1);
    const bps = Math.round((bytes * 8 / ms) * 1000);
    return Math.min(CONSTANTS.THROUGHPUT_SOFT_CAP_BPS, bps);
  }
}

class NodeManager extends EventEmitter {
  static getInstance() {
    if (!NodeManager.instance) NodeManager.instance = new NodeManager();
    return NodeManager.instance;
  }

  constructor() {
    super();
    this.currentNode = PLATFORM.isFlClash ? $flclash?.getCurrentNode?.() || null : null;
    this.nodeQuality = new Map();
    this.switchCooldown = new Map();
    this.nodeHistory = new Map();
    this.nodeSuccess = new Map();
    // FlClash 节点状态同步
    if (PLATFORM.isFlClash) {
      const nodes = $flclash?.getProxies?.() || [];
      nodes.forEach(node => this.nodeQuality.set(node.id, 50));
    }
  }

  isInCooldown(nodeId) {
    const endTime = this.switchCooldown.get(nodeId);
    return !!endTime && Date.now() < endTime;
  }

  _getCooldownTime(nodeId) {
    const score = Math.max(0, Math.min(100, this.nodeQuality.get(nodeId) || 0));
    const factor = 1 + (score / 100) * 0.9;
    return Math.max(
      CONSTANTS.MIN_SWITCH_COOLDOWN,
      Math.min(CONSTANTS.MAX_SWITCH_COOLDOWN, CONSTANTS.BASE_SWITCH_COOLDOWN * factor)
    );
  }

  _recordSwitchEvent(oldNodeId, newNodeId, targetGeo) {
    Logger.debug("节点切换事件:", {
      timestamp: Date.now(),
      oldNodeId,
      newNodeId,
      targetGeo: targetGeo ? { country: targetGeo.country, region: targetGeo.regionName || targetGeo.region } : null,
      reason: oldNodeId ? "质量过低" : "初始选择"
    });
    // FlClash 节点切换同步
    PLATFORM.isFlClash && $flclash?.switchNode?.(newNodeId);
  }

  _updateNodeHistory(nodeId, score) {
    const validScore = Math.max(0, Math.min(100, Number(score) || 0));
    const history = this.nodeHistory.get(nodeId) || [];
    history.push({ timestamp: Date.now(), score: validScore });
    if (history.length > CONSTANTS.MAX_HISTORY_RECORDS) {
      this.nodeHistory.set(nodeId, history.slice(-CONSTANTS.MAX_HISTORY_RECORDS));
    } else {
      this.nodeHistory.set(nodeId, history);
    }
  }

  updateNodeQuality(nodeId, scoreDelta) {
    const delta = Math.max(-20, Math.min(20, Number(scoreDelta) || 0));
    const currentScore = this.nodeQuality.get(nodeId) || 0;
    const newScore = Math.max(0, Math.min(100, currentScore + delta));
    this.nodeQuality.set(nodeId, newScore);
    this._updateNodeHistory(nodeId, newScore);
    // FlClash 质量分同步
    PLATFORM.isFlClash && $flclash?.setNodeQuality?.(nodeId, newScore);
  }

  _selectBestPerformanceNode(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      Logger.warn("节点列表为空");
      return null;
    }
    const central = CentralManager.getInstance();
    const scoreNode = (node) => {
      if (!node?.id) return 0;
      const quality = this.nodeQuality.get(node.id) || 0;
      const nodeState = central.state.nodes.get(node.id) || {};
      const metrics = nodeState.metrics || {};
      const availabilityRate = nodeState.availabilityRate || 0;
      const availabilityPenalty = availabilityRate < CONSTANTS.AVAILABILITY_MIN_RATE ? CONSTANTS.BIAS_AVAIL_PENALTY_BAD : 0;
      const { metricScore } = CentralManager.scoreComponents(metrics);
      const successRate = this.nodeSuccess.get(node.id)?.rate || 0;
      const successRatePercent = successRate * 100;
      const totalWeight = CONSTANTS.QUALITY_WEIGHT + CONSTANTS.METRIC_WEIGHT + CONSTANTS.SUCCESS_WEIGHT || 1;
      return (
        (quality * CONSTANTS.QUALITY_WEIGHT / totalWeight) +
        (metricScore * CONSTANTS.METRIC_WEIGHT / totalWeight) +
        (successRatePercent * CONSTANTS.SUCCESS_WEIGHT / totalWeight) +
        availabilityPenalty
      );
    };
    return nodes.reduce((best, current) => {
      const bestScore = scoreNode(best);
      const currentScore = scoreNode(current);
      return currentScore > bestScore ? current : best;
    }, nodes[0]);
  }

  async getBestNode(nodes, targetGeo) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      Logger.warn("无效的节点列表");
      return null;
    }
    const central = CentralManager.getInstance();
    let candidateNodes = nodes.filter(node => !this.isInCooldown(node.id));
    if (candidateNodes.length === 0) candidateNodes = nodes;
    if (targetGeo?.regionName) {
      const regionalNodes = candidateNodes.filter(node => {
        const nodeState = central.state.nodes.get(node.id);
        return nodeState?.geoInfo?.regionName === targetGeo.regionName;
      });
      if (regionalNodes.length > 0) candidateNodes = regionalNodes;
    }
    return this._selectBestPerformanceNode(candidateNodes) || candidateNodes[0];
  }

  async switchToNode(nodeId, targetGeo) {
    if (typeof nodeId !== "string") {
      Logger.warn("无效的节点ID");
      return null;
    }
    if (this.currentNode === nodeId) return { id: nodeId };
    const central = CentralManager.getInstance();
    const node = central.state.config.proxies?.find(n => n.id === nodeId);
    if (!node) {
      Logger.warn(`节点不存在: ${nodeId}`);
      return null;
    }
    const oldNodeId = this.currentNode;
    this.currentNode = nodeId;
    this.switchCooldown.set(nodeId, Date.now() + this._getCooldownTime(nodeId));
    this._recordSwitchEvent(oldNodeId, nodeId, targetGeo);
    const nodeState = central.state.nodes.get(nodeId);
    const region = nodeState?.geoInfo?.regionName || "未知区域";
    Logger.info(`节点切换: ${oldNodeId || "无"} -> ${nodeId} (区域: ${region})`);
    return node;
  }

  async switchToBestNode(nodes, targetGeo) {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    const bestNode = await this.getBestNode(nodes, targetGeo);
    if (!bestNode) return null;
    return this.switchToNode(bestNode.id, targetGeo);
  }
}

class CentralManager extends EventEmitter {
  static getInstance() {
    if (!CentralManager.instance) CentralManager.instance = new CentralManager();
    return CentralManager.instance;
  }

  constructor() {
    super();
    if (CentralManager.instance) return CentralManager.instance;
    this.state = new AppState();
    this.stats = new RollingStats();
    this.successTracker = new SuccessRateTracker();
    this.nodeManager = NodeManager.getInstance();
    this.lruCache = new LRUCache();
    this.geoInfoCache = new LRUCache();
    this.metricsManager = new MetricsManager(this.state);
    this.availabilityTracker = new AvailabilityTracker(this.state, this.nodeManager);
    this.throughputEstimator = new ThroughputEstimator();
    this._listenersRegistered = false;
    CentralManager.instance = this;
    // FlClash 初始化钩子
    if (PLATFORM.isFlClash && $flclash?.onReady) {
      $flclash.onReady(() => this.initialize().catch(err => Logger.error("初始化失败:", err.stack || err)));
    } else {
      Promise.resolve().then(() => this.initialize().catch(err => Logger.error("初始化失败:", err.stack || err)));
    }
  }

  static scoreComponents(metrics = {}) {
    const latency = Math.max(0, Math.min(CONSTANTS.LATENCY_CLAMP_MS, Number(metrics.latency) || 0));
    const jitter = Math.max(0, Math.min(CONSTANTS.JITTER_CLAMP_MS, Number(metrics.jitter) || 0));
    const loss = Math.max(0, Math.min(CONSTANTS.LOSS_CLAMP, Number(metrics.loss) || 0));
    const bps = Math.max(0, Math.min(CONSTANTS.THROUGHPUT_SOFT_CAP_BPS, Number(metrics.bps) || 0));
    const latencyScore = Math.max(0, Math.min(35, 35 - latency / 25));
    const jitterScore = Math.max(0, Math.min(25, 25 - jitter));
    const lossScore = Math.max(0, Math.min(25, 25 * (1 - loss)));
    const throughputScore = Math.max(0, Math.min(CONSTANTS.THROUGHPUT_SCORE_MAX, Math.round(Math.log10(1 + bps) * 2)));
    const metricScore = Math.round(latencyScore + jitterScore + lossScore + throughputScore);
    return { latencyScore, jitterScore, lossScore, throughputScore, metricScore: Math.min(100, metricScore) };
  }

  async _getFetchRuntime() {
    let fetch = typeof fetch === "function" ? fetch : null;
    let AbortController = typeof AbortController !== "undefined" ? AbortController : null;
    if (!fetch && PLATFORM.isNode) {
      try {
        const nodeFetch = require("node-fetch");
        fetch = nodeFetch.default || nodeFetch;
      } catch {}
      if (!AbortController) {
        try {
          const abortController = require("abort-controller");
          AbortController = abortController.default || abortController;
        } catch {}
      }
    }
    // FlClash 内置fetch适配
    if (!fetch && PLATFORM.isFlClash && $flclash?.fetch) {
      fetch = $flclash.fetch;
    }
    return { fetch, AbortController };
  }

  async _safeFetch(url, options = {}, timeout = CONSTANTS.GEO_INFO_TIMEOUT) {
    if (typeof url !== "string") throw new Error("无效的URL");
    const { fetch, AbortController } = await this._getFetchRuntime();
    if (!fetch) throw new Error("fetch不可用");
    if (url.startsWith("https://raw.githubusercontent.com/") || url.startsWith("https://github.com/")) {
      try {
        const mirror = await selectBestMirror(fetch);
        url = `${mirror}${url}`;
      } catch (e) {
        Logger.warn("GitHub镜像加速失败:", e.message);
      }
    }
    const defaultOptions = {
      headers: { "User-Agent": CONSTANTS.DEFAULT_USER_AGENT, ...options.headers },
      redirect: options.redirect || "follow",
      ...options
    };
    if (AbortController && timeout > 0) {
      const controller = new AbortController();
      defaultOptions.signal = controller.signal;
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, defaultOptions);
        clearTimeout(timer);
        return response;
      } catch (e) {
        clearTimeout(timer);
        if (e.name === "AbortError") throw new Error(`请求超时 (${timeout}ms)`);
        throw e;
      }
    }
    if (timeout > 0) {
      const fetchPromise = fetch(url, defaultOptions);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`请求超时 (${timeout}ms)`)), timeout);
      });
      return Promise.race([fetchPromise, timeoutPromise]);
    }
    return fetch(url, defaultOptions);
  }

  async initialize() {
    try {
      const { fetch } = await this._getFetchRuntime();
      if (fetch) await selectBestMirror(fetch);
      await this.loadAIDBFromFile().catch(e => Logger.warn("加载AI数据失败:", e.message));
      if (!this._listenersRegistered) {
        this.setupEventListeners();
        this._listenersRegistered = true;
      }
      this.on("requestDetected", targetIp => {
        this.handleRequestWithGeoRouting(targetIp).catch(e => Logger.warn("地理路由处理失败:", e.message));
      });
      await this.preheatNodes().catch(e => Logger.warn("节点预热失败:", e.message));
      this.registerCleanupHandlers();
      // FlClash 初始化完成通知
      PLATFORM.isFlClash && $flclash?.notify?.(`FlClash 中央调度初始化完成`);
      Logger.info("初始化完成");
    } catch (e) {
      Logger.error("初始化异常:", e.stack || e);
      PLATFORM.isFlClash && $flclash?.notify?.(`初始化失败: ${e.message}`);
    }
  }

  registerCleanupHandlers() {
    try {
      if (PLATFORM.isNode && process.on) {
        const cleanup = () => this.destroy().catch(e => Logger.error("清理失败:", e.message));
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
      } else if (PLATFORM.isBrowser && window.addEventListener) {
        window.addEventListener("beforeunload", () => {
          this.destroy().catch(e => Logger.error("清理失败:", e.message));
        });
      } else if (PLATFORM.isFlClash && $flclash?.onExit) {
        $flclash.onExit(() => this.destroy().catch(e => Logger.error("清理失败:", e.message)));
      }
    } catch (e) {
      Logger.warn("注册清理处理器失败:", e.message);
    }
  }

  setupEventListeners() {
    const listeners = {
      configChanged: () => this.onConfigChanged(),
      networkOnline: () => this.onNetworkOnline(),
      performanceThresholdBreached: (nodeId) => this.onPerformanceThresholdBreached(nodeId),
      evaluationCompleted: () => this.onEvaluationCompleted()
    };
    this.nodeManager.on("performanceThresholdBreached", listeners.performanceThresholdBreached);
    this.on("evaluationCompleted", listeners.evaluationCompleted);
    this.eventListeners = listeners;
  }

  cleanupEventListeners() {
    if (!this.eventListeners) return;
    this.nodeManager.off("performanceThresholdBreached", this.eventListeners.performanceThresholdBreached);
    this.off("evaluationCompleted", this.eventListeners.evaluationCompleted);
    this.eventListeners = null;
  }

  async destroy() {
    Logger.info("开始清理资源");
    try {
      this.cleanupEventListeners();
      this._listenersRegistered = false;
      await this.saveAIDBToFile().catch(e => Logger.warn("保存AI数据失败:", e.message));
      this.lruCache.clear();
      this.geoInfoCache.clear();
      Logger.info("资源清理完成");
    } catch (e) {
      Logger.error("销毁失败:", e.stack || e);
    }
  }

  async preheatNodes() {
    const proxies = this.state.config.proxies || [];
    if (proxies.length === 0) return;
    const testNodes = proxies.slice(0, CONSTANTS.PREHEAT_NODE_COUNT);
    const tasks = testNodes.map(node => () => this.testNodeMultiMetrics(node));
    const results = await Utils.asyncPool(tasks, CONSTANTS.CONCURRENCY_LIMIT);
    results.forEach((result, idx) => {
      const node = testNodes[idx];
      if (result.__error) {
        Logger.error(`节点预热失败: ${node.id}`, result.__error.message);
        return;
      }
      const bps = this.throughputEstimator.bpsFromBytesLatency(result);
      const metrics = { ...result, bps };
      this.state.updateNodeStatus(node.id, { initialMetrics: metrics, lastTested: Date.now() });
      this.metricsManager.append(node.id, metrics);
      this.nodeManager.updateNodeQuality(node.id, CentralManager.scoreComponents(metrics).metricScore);
      this.availabilityTracker.ensure(node.id);
    });
  }

  async evaluateNodeQuality(node) {
    if (!node?.id) {
      Logger.warn("无效的节点");
      return;
    }
    let metrics;
    try {
      metrics = await Utils.retry(() => this.testNodeMultiMetrics(node), CONSTANTS.MAX_RETRY_ATTEMPTS);
    } catch {
      Logger.warn(`节点探测失败，使用模拟数据: ${node.id}`);
      metrics = {
        latency: CONSTANTS.NODE_TEST_TIMEOUT,
        loss: 1,
        jitter: 100,
        bytes: 0,
        bps: 0,
        __simulated: true
      };
    }
    if (typeof metrics.bps !== "number") {
      metrics.bps = this.throughputEstimator.bpsFromBytesLatency(metrics);
    }
    this.availabilityTracker.ensure(node.id);
    const isSimulated = metrics.__simulated;
    const latency = Math.max(0, Number(metrics.latency) || 0);
    const timeoutThreshold = CONSTANTS.NODE_TEST_TIMEOUT * 2;
    const hardFail = !!metrics.__hardFail;
    const success = !isSimulated && latency < timeoutThreshold && !hardFail;
    this.availabilityTracker.record(node.id, success, { hardFail });
    let score;
    try {
      score = Math.max(0, Math.min(100, CentralManager.scoreComponents(metrics).metricScore));
    } catch (e) {
      Logger.error(`计算节点质量分失败: ${node.id}`, e.message);
      score = 0;
    }
    let geoInfo = null;
    try {
      const nodeIp = node.server?.split(":")[0];
      const allowGeoLookup = !(Config?.privacy?.geoExternalLookup === false);
      if (nodeIp && Utils.isIPv4(nodeIp) && !Utils.isPrivateIP(nodeIp) && allowGeoLookup) {
        geoInfo = await this.getGeoInfo(nodeIp);
      }
    } catch (e) {
      Logger.debug(`获取节点地理信息失败: ${node.id}`, e.message);
    }
    try {
      this.nodeManager.updateNodeQuality(node.id, score);
      this.metricsManager.append(node.id, metrics);
      const availabilityRate = this.availabilityTracker.rate(node.id);
      this.state.updateNodeStatus(node.id, {
        metrics,
        score,
        geoInfo,
        lastEvaluated: Date.now(),
        availabilityRate
      });
    } catch (e) {
      Logger.error(`更新节点状态失败: ${node.id}`, e.message);
    }
    try {
      const isCurrentNode = this.nodeManager.currentNode === node.id;
      const availabilityRate = this.availabilityTracker.rate(node.id);
      const failStreak = this.availabilityTracker.hardFailStreak(node.id);
      if (isCurrentNode && (hardFail || availabilityRate < CONSTANTS.AVAILABILITY_MIN_RATE || score < CONSTANTS.QUALITY_SCORE_THRESHOLD)) {
        const proxies = this.state.config.proxies || [];
        if (proxies.length > 0) {
          if (failStreak >= CONSTANTS.AVAILABILITY_EMERGENCY_FAILS) {
            this.nodeManager.switchCooldown.delete(node.id);
          }
          await this.nodeManager.switchToBestNode(proxies);
        }
      }
    } catch (e) {
      Logger.warn(`节点切换失败: ${node.id}`, e.message);
    }
  }

  async evaluateAllNodes() {
    const proxies = this.state.config.proxies || [];
    if (proxies.length === 0) return;
    const tasks = proxies.map(node => () => this.evaluateNodeQuality(node));
    const results = await Utils.asyncPool(tasks, CONSTANTS.CONCURRENCY_LIMIT);
    results.forEach((result, idx) => {
      if (result.__error) {
        Logger.warn(`节点评估失败: ${proxies[idx]?.id}`, result.__error.message);
      }
    });
    this.emit("evaluationCompleted");
  }

  async testNodeMultiMetrics(node) {
    const cacheKey = `nodeMetrics:${node.id}`;
    const cached = this.lruCache.get(cacheKey);
    if (cached) return cached;
    const timeout = CONSTANTS.NODE_TEST_TIMEOUT;
    try {
      const probeUrl = node.proxyUrl || node.probeUrl || (node.server ? `http://${node.server}` : null);
      if (!probeUrl) throw new Error("无探测URL");
      let tcpLatency = null;
      if (PLATFORM.isNode && node.server) {
        const [host, portStr] = node.server.split(":");
        const port = parseInt(portStr || "80", 10);
        tcpLatency = await this.throughputEstimator.tcpConnectLatency(host, port, timeout).catch(() => null);
      }
      const startTime = Date.now();
      const response = await this._safeFetch(probeUrl, { method: "GET" }, timeout);
      const latency = Date.now() - startTime;
      const { bytes, jitter } = await this.throughputEstimator.measureResponse(response);
      const bps = this.throughputEstimator.bpsFromBytesLatency({ bytes, latency });
      const finalLatency = tcpLatency && tcpLatency < latency ? tcpLatency : latency;
      const result = { latency: finalLatency, loss: 0, jitter, bytes, bps };
      this.lruCache.set(cacheKey, result, 60000);
      return result;
    } catch (e) {
      Logger.debug(`节点探测失败: ${node.id}`, e.message);
      const result = {
        latency: timeout,
        loss: 1,
        jitter: 100,
        bytes: 0,
        bps: 0,
        __hardFail: true
      };
      this.lruCache.set(cacheKey, result, 60000);
      return result;
    }
  }

  async handleRequestWithGeoRouting(targetIp) {
    const proxies = this.state.config.proxies || [];
    if (!targetIp || proxies.length === 0) {
      Logger.warn("无法进行地理路由");
      await this.nodeManager.switchToBestNode(proxies);
      return;
    }
    const allowGeoLookup = !(Config?.privacy?.geoExternalLookup === false);
    const targetGeo = allowGeoLookup ? await this.getGeoInfo(targetIp) : this._getFallbackGeoInfo();
    if (!targetGeo) {
      Logger.warn("无法获取目标地理信息");
      await this.nodeManager.switchToBestNode(proxies);
      return;
    }
    await this.nodeManager.switchToBestNode(proxies, targetGeo);
  }

  async getGeoInfo(ip, domain) {
    if (!ip) return this._getFallbackGeoInfo(domain);
    if (Utils.isPrivateIP(ip)) return { country: "Local", region: "Local" };
    const cached = this.geoInfoCache.get(ip);
    if (cached) return cached;
    if (Config?.privacy?.geoExternalLookup === false) {
      const fallback = this._getFallbackGeoInfo(domain);
      this.geoInfoCache.set(ip, fallback, CONSTANTS.GEO_FALLBACK_TTL);
      return fallback;
    }
    try {
      let geoInfo = await this._fetchGeoFromPrimaryAPI(ip);
      if (geoInfo) {
        this.geoInfoCache.set(ip, geoInfo);
        return geoInfo;
      }
      geoInfo = await this._fetchGeoFromFallbackAPI(ip);
      if (geoInfo) {
        this.geoInfoCache.set(ip, geoInfo);
        return geoInfo;
      }
      const fallback = this._getFallbackGeoInfo(domain);
      this.geoInfoCache.set(ip, fallback, CONSTANTS.GEO_FALLBACK_TTL);
      return fallback;
    } catch (e) {
      Logger.error(`获取地理信息失败: ${ip}`, e.message);
      return this._getFallbackGeoInfo(domain);
    }
  }

  async _fetchGeoFromPrimaryAPI(ip) {
    if (!Utils.isIPv4(ip)) return null;
    try {
      const response = await this._safeFetch(`https://ipapi.co/${ip}/json/`, {}, CONSTANTS.GEO_INFO_TIMEOUT);
      if (!response.ok) throw new Error(`HTTP状态码: ${response.status}`);
      const data = await response.json();
      if (data.country_name) {
        return {
          country: data.country_name,
          region: data.region || data.city || "Unknown"
        };
      }
      return null;
    } catch (e) {
      Logger.warn("主地理API调用失败:", e.message);
      return null;
    }
  }

  async _fetchGeoFromFallbackAPI(ip) {
    try {
      const response = await this._safeFetch(`https://ipinfo.io/${ip}/json`, {}, CONSTANTS.GEO_INFO_TIMEOUT);
      if (!response.ok) throw new Error(`HTTP状态码: ${response.status}`);
      const data = await response.json();
      if (data.country) {
        return {
          country: data.country,
          region: data.region || data.city || "Unknown"
        };
      }
      return null;
    } catch (e) {
      Logger.warn("备用地理API调用失败:", e.message);
      return null;
    }
  }

  _getFallbackGeoInfo(domain) {
    if (domain && Utils.isValidDomain(domain)) {
      const tld = domain.split(".").pop().toLowerCase();
      const tldMap = {
        cn: "China",
        hk: "Hong Kong",
        tw: "Taiwan",
        jp: "Japan",
        kr: "Korea",
        us: "United States",
        uk: "United Kingdom",
        de: "Germany",
        fr: "France",
        ca: "Canada
