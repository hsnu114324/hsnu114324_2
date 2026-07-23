let COLS = 6;
const ROWS = 8;
const FALL_MS = 550;

// 後備字庫：無任何來源設定時，取 B1 群組前 30 列
const DEFAULT_WORD_ROWS =
  (window.WORD_DATA && window.WORD_DATA.groups && window.WORD_DATA.groups[0].length)
    ? window.WORD_DATA.groups[0].slice(0, 30)
    : ["蘋果,der Apfel", "喝,trinken"];

const COLORS = [
  "#ff7a7a",
  "#ffbe5c",
  "#7ed957",
  "#45d0e6",
  "#7ea6ff",
  "#c58bff",
  "#ff89d5",
];

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const progressEl = document.getElementById("progress");
const messageEl = document.getElementById("message");
const restartBtn = document.getElementById("restartBtn");
const autoBtn = document.getElementById("autoBtn");
const debugBoxEl = document.getElementById("debugBox");
const leftBtn = document.getElementById("leftBtn");
const downBtn = document.getElementById("downBtn");
const rightBtn = document.getElementById("rightBtn");

groupData = loadGroupData();  // 載入群組資料（必須在 loadWordRows 之前）
let ALL_WORD_ROWS = loadWordRows();
let allComboList = buildComboList(ALL_WORD_ROWS);

const MAX_ACTIVE_COMBOS = 6;   // 同時在場的最大 combo 數量

let comboList = [];        // 目前在場的 combos（會隨消除＋補充而成長）
let comboReserve = [];     // 尚未上場的 combos（等待補入）
let totalComboCount = 0;   // 全部 combo 數量（在場 + 候補 + 已消除）

let cellSize = 44;
let board = createEmptyBoard();
let activeBlock = null;
let score = 0;
let lastTick = 0;
let gameLoopId = null;
let running = true;
let animating = false;  // 消除動畫播放中
let particles = [];     // 爆散粒子
let clearedCombos = new Set(); // 已消除的 combo 索引
let _appearedCombos = new Set(); // 已記錄 appear 的 combo 索引（延遲到實際發牌才記）
let wordQueue = [];     // 派發佇列：確保所有組合輪過一遍
let nextWordQueue = []; // 下一輪派發佇列（預先建立，讓 AI 可以看到）
let autoMode = false;       // 自動模式
let autoTargetCol = -1;     // AI 目標欄
let autoLastMoveTime = 0;   // 上次 AI 移動時間戳
const AUTO_MOVE_MS = 100;   // AI 每步間隔 ms
let autoPlan = [];           // 快取：整場最佳策略 [{word, col}, ...]
let autoPlanStep = 0;        // 目前執行到第幾步
let aiComputing = false;     // AI 正在計算中
let aiSearchGen = 0;         // 搜索世代（用於取消舊搜索）
let debugMode = localStorage.getItem("word_tetris_debug_v1") === "1";
let blockCount = 0;  // 已落下的方塊數

function buildComboList(rows) {
  const swMode = isSingleWordMode();
  const isLetterMode = swMode && loadSplitMode() === "letter";
  const maxBlocks = isLetterMode ? 30 : 4;
  const maxComboLen = isLetterMode ? 30 : 5;
  return rows.map((row, index) => {
    const words = row
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length < 2 || words.length > maxComboLen) {
      throw new Error(`第 ${index + 1} 組資料需要 2~${maxComboLen} 個欄位`);
    }
    if (swMode && words.length === 2) {
      const hint = words[0];
      const germanBlocks = splitGermanToBlocks(words[1], maxBlocks);
      const expanded = [hint, ...germanBlocks];
      if (expanded.length >= 2 && expanded.length <= maxComboLen) {
        expanded._origRow = row;
        return expanded;
      }
    }
    return words;
  });
}

function loadWordRows() {
  const ag = loadActiveGroups();
  const ca = isCustomActive();
  const rows = [];

  // 載入群組 word
  // GROUP_REMOVED_KEY 同時記錄「設定頁手動移除」和「遊戲中自動移除」，需始終載入
  if (ag.length > 0) {
    const removed = loadGroupRemoved();
    for (const gi of ag) {
      const removedSet = new Set(
        (removed[gi] || []).map(s => s.split(",").map(p => p.trim().toLowerCase()).filter(Boolean).join(","))
      );
      for (const row of groupData[gi]) {
        const key = row.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
        if (!removedSet.has(key)) {
          rows.push(row);
        }
      }
    }
  }

  // 載入自定義 word
  if (ca) {
    const swMode = isSingleWordMode();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            if (!isValidRowString(r)) continue;
            // 單字模式：只載入 2 欄項目（中文提示 + 德文單字）
            if (swMode) {
              const parts = r.split(",").map(s => s.trim()).filter(Boolean);
              if (parts.length !== 2) continue;
            }
            rows.push(r);
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  if (rows.length > 0) return rows;

  // fallback：若所有來源都空，嘗試完整群組或預設
  if (ag.length > 0) {
    const allRows = [];
    for (const gi of ag) allRows.push(...groupData[gi]);
    if (allRows.length > 0) return allRows;
  }
  return [...DEFAULT_WORD_ROWS];
}

// 將 combo 陣列正規化為可比對的字串（去空白、小寫）
function normalizeComboKey(combo) {
  return combo.map(w => w.trim().toLowerCase()).join(",");
}

/** 記錄 combo 出現（進入在場區） */
function trackComboAppear(combos) {
  const stats = loadComboStats();
  for (const combo of combos) {
    // 單字模式：用原始 2 欄格式作為 key 和 display，而非拆開的版本
    const key = combo._origRow
      ? combo._origRow.split(",").map(w => w.trim().toLowerCase()).filter(Boolean).join(",")
      : normalizeComboKey(combo);
    const display = combo._origRow || combo.join(",");
    if (!stats[key]) {
      stats[key] = { appear: 0, cleared: 0, display, lastSeen: "" };
    }
    stats[key].appear++;
    stats[key].lastSeen = new Date().toISOString().slice(0, 10);
    stats[key].display = display;
    if (combo._origRow) {
      stats[key].origRow = combo._origRow;
    }
  }
  saveComboStats(stats);
}

/** 記錄 combo 被成功消除 */
function trackComboCleared(clearedIndices) {
  if (clearedIndices.length === 0) return;
  const stats = loadComboStats();
  for (const ci of clearedIndices) {
    if (ci >= comboList.length) continue;
    const combo = comboList[ci];
    // 單字模式：用原始 2 欄格式作為 key 和 display
    const key = combo._origRow
      ? combo._origRow.split(",").map(w => w.trim().toLowerCase()).filter(Boolean).join(",")
      : normalizeComboKey(combo);
    const display = combo._origRow || combo.join(",");
    if (!stats[key]) {
      stats[key] = { appear: 0, cleared: 0, display, lastSeen: "" };
    }
    stats[key].cleared++;
    stats[key].lastSeen = new Date().toISOString().slice(0, 10);
    if (combo._origRow) {
      stats[key].origRow = combo._origRow;
    }
  }
  saveComboStats(stats);
}

// 自動移除已消除的 combo 對應的 row（從 localStorage）
function autoRemoveClearedRows(clearedComboIndices) {
  if (!isAutoRemoveMode()) return;

  // 收集要移除的 combo 的正規化 key
  const keysToRemove = new Set();
  for (const ci of clearedComboIndices) {
    if (ci < comboList.length) {
      const combo = comboList[ci];
      keysToRemove.add(normalizeComboKey(combo));
      // 單字模式：combo 是拆開的，但 STORAGE_KEY 存的是原始 2 欄格式
      // 需要同時加入原始 key 才能正確配對移除
      if (combo._origRow) {
        const origKey = combo._origRow.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
        keysToRemove.add(origKey);
      }
    }
  }
  if (keysToRemove.size === 0) return;

  // 實際被移除的 word 數（用於更新 pickCount）
  let totalRemoved = 0;

  // 群組模式：記錄已移除的 word 到 GROUP_REMOVED_KEY
  const ag = loadActiveGroups();
  if (ag.length > 0) {
    try {
      const removed = loadGroupRemoved();
      let groupRemoved = 0;
      for (const gi of ag) {
        if (!removed[gi]) removed[gi] = [];
        const existingSet = new Set(
          removed[gi].map(s => s.split(",").map(p => p.trim().toLowerCase()).filter(Boolean).join(","))
        );
        for (const row of groupData[gi]) {
          const key = row.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
          if (keysToRemove.has(key) && !existingSet.has(key)) {
            removed[gi].push(row);
            groupRemoved++;
          }
        }
      }
      if (groupRemoved > 0) {
        saveGroupRemoved(removed);
        totalRemoved += groupRemoved;
      }
    } catch (e) {
      // 忽略錯誤
    }
  }

  // 自訂模式：從 STORAGE_KEY 和 CUSTOM_FULL_KEY 同步移除
  if (isCustomActive()) {
    const filterRows = (arr) => arr.filter(row => {
      const parts = row.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const key = parts.join(",");
      return !keysToRemove.has(key);
    });
    // STORAGE_KEY（customRows）
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        let storedRows = JSON.parse(raw);
        if (Array.isArray(storedRows)) {
          const before = storedRows.length;
          storedRows = filterRows(storedRows);
          if (storedRows.length < before) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRows));
            totalRemoved += (before - storedRows.length);
          }
        }
      }
    } catch (e) { /* ignore */ }
    // CUSTOM_FULL_KEY 保留完整單字庫，不在遊戲中移除，
    // 讓使用者回到設定頁時仍可切換不同字母重新選取。
  }

  // ── 同步遞減「隨機抽取組數」，讓重新開始時組數跟著減少 ──
  if (totalRemoved > 0) {
    try {
      const currentPick = loadPickCount();
      if (currentPick > 0) {
        const newPick = Math.max(0, currentPick - totalRemoved);
        localStorage.setItem(PICK_KEY, String(newPick));
      }
    } catch (e) { /* ignore */ }
  }
}

function loadAllowedLens() {
  try {
    const raw = localStorage.getItem(LENS_KEY);
    if (!raw) return null; // null = 不篩選（全部允許）
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    return null;
  } catch { return null; }
}

// 從全部 combo 中隨機抽 n 組（0 = 全部），並依允許長度篩選
function pickFilteredCombos() {
  const allowedLens = loadAllowedLens();
  const swMode = isSingleWordMode();
  // 先依長度篩選（單字模式跳過：長度由拆字邏輯決定）
  let pool = allComboList;
  if (allowedLens && !swMode) {
    pool = allComboList.filter(combo => allowedLens.has(combo.length));
    if (pool.length === 0) pool = allComboList; // 全被過濾掉時 fallback
  }

  const n = loadPickCount();
  if (n <= 0 || n >= pool.length) {
    return [...pool];
  }
  // Fisher-Yates 取前 n 個
  const indices = Array.from({ length: pool.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, n).sort((a, b) => a - b).map((i) => pool[i]);
}

// 初始化 combo 池：取前 MAX_ACTIVE_COMBOS 個上場，其餘放候補
// 單字模式：一次只放 1 組上場
function initComboPool() {
  const all = pickFilteredCombos();
  const swMode = isSingleWordMode();
  const maxActive = swMode ? 1 : MAX_ACTIVE_COMBOS;

  // 洗牌讓上場順序隨機
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  totalComboCount = all.length;
  if (all.length <= maxActive) {
    comboList = all;
    comboReserve = [];
  } else {
    comboList = all.slice(0, maxActive);
    comboReserve = all.slice(maxActive);
  }
  // appear 統計改由 spawnBlock 延遲記錄（方塊實際發出時才算）
}

// 消除 combo 後，從候補區補入新 combo（每消一組補一組）
function replenishCombos(newlyClearedCount) {
  const swMode = isSingleWordMode();
  let added = 0;
  const newlyAdded = [];
  for (let i = 0; i < newlyClearedCount && comboReserve.length > 0; i++) {
    const newCombo = comboReserve.shift();
    comboList.push(newCombo);
    newlyAdded.push(newCombo);

    if (!swMode) {
      // 一般模式：把新 combo 的字立刻混入現有佇列
      const newWords = [...newCombo];
      for (let j = newWords.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [newWords[j], newWords[k]] = [newWords[k], newWords[j]];
      }
      // 隨機插入 wordQueue
      for (const w of newWords) {
        const pos = Math.floor(Math.random() * (wordQueue.length + 1));
        wordQueue.splice(pos, 0, w);
      }
    }
    // 單字模式：不插入舊 queue，clearMatches 會在消除後強制重建

    added++;
  }
  // appear 統計改由 spawnBlock 延遲記錄
  return added;
}

function setMessage(text, isOk = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", isOk);
}

function setDebugText(text) {
  if (!debugBoxEl || !debugMode) return;
  debugBoxEl.textContent = text || "";
}

function initDebugMode() {
  debugMode = localStorage.getItem("word_tetris_debug_v1") === "1";
  if (debugBoxEl) {
    debugBoxEl.classList.toggle("show", debugMode);
    if (!debugMode) debugBoxEl.textContent = "";
  }
  // 偵錯模式開啟時才顯示自動按鈕
  if (autoBtn) {
    autoBtn.style.display = debugMode ? "" : "none";
    if (!debugMode && autoMode) {
      // 關閉偵錯時，同時關閉自動模式
      autoMode = false;
      autoBtn.textContent = "自動";
      autoBtn.classList.remove("active");
      aiSearchGen++;
      autoTargetCol = -1;
      aiComputing = false;
      clearAutoPlan();
    }
  }
}

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function nextWordColor(word) {
  let sum = 0;
  for (let i = 0; i < word.length; i += 1) {
    sum += word.charCodeAt(i);
  }
  return COLORS[sum % COLORS.length];
}

function resizeCanvas() {
  const maxWidth = Math.min(window.innerWidth - 24, 460);
  cellSize = Math.floor(maxWidth / COLS);
  const dpr = window.devicePixelRatio || 1;
  const w = cellSize * COLS;
  const h = cellSize * ROWS;
  // 內部解析度依 DPI 放大，CSS 尺寸維持不變
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid();
}

// 建立一輪派發佇列：只包含尚未消除的 combo 的字，隨機打亂
function buildWordQueue() {
  const queue = [];
  for (let ci = 0; ci < comboList.length; ci++) {
    if (clearedCombos.has(ci)) continue; // 已消除的 combo 不再發牌
    for (const word of comboList[ci]) {
      queue.push(word);
    }
  }
  // Fisher-Yates 洗牌
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

// 消除後清理佇列：移除只屬於已消除 combo 的字（兩個佇列都清理）
function purgeWordQueue() {
  const activeWords = new Set();
  for (let ci = 0; ci < comboList.length; ci++) {
    if (clearedCombos.has(ci)) continue;
    for (const w of comboList[ci]) activeWords.add(w);
  }
  wordQueue = wordQueue.filter((w) => activeWords.has(w));
  nextWordQueue = nextWordQueue.filter((w) => activeWords.has(w));
}

function ensureQueues() {
  // 確保 wordQueue 和 nextWordQueue 都有內容
  if (!wordQueue.length) {
    if (nextWordQueue.length) {
      // 把下一輪升級為當前
      wordQueue = nextWordQueue;
    } else {
      wordQueue = buildWordQueue();
    }
    // 預建下一輪
    nextWordQueue = buildWordQueue();
  }
  if (!nextWordQueue.length) {
    nextWordQueue = buildWordQueue();
  }
}

function nextWord() {
  ensureQueues();
  if (!wordQueue.length) {
    // 所有 combo 都已消除，不應再發牌（安全防護）
    return comboList[0]?.[0] || "?";
  }
  return wordQueue.shift();
}

// ── 自動模式 AI v5：全模擬版型枚舉 ──
// 枚舉所有 combo 起始欄組合，對每種版型完整模擬遊戲
// 版型數超過上限時改為隨機取樣

// ── 字詞索引 ──
let _wToI = null;
let _iToW = null;
let _cIdx = null;

function buildWordIndex() {
  _wToI = new Map();
  _iToW = [""];
  for (const combo of comboList)
    for (const w of combo)
      if (!_wToI.has(w)) { _wToI.set(w, _iToW.length); _iToW.push(w); }
  _cIdx = comboList.map(c => Uint8Array.from(c.map(w => _wToI.get(w))));
}

function boardToFlat(b) {
  const f = new Uint8Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cell = b[r][c];
      if (cell !== null) {
        const w = typeof cell === "string" ? cell : cell.word;
        f[r * COLS + c] = _wToI.get(w) || 0;
      }
    }
  return f;
}

function simGravity(f) {
  for (let col = 0; col < COLS; col++) {
    let wi = ROWS - 1;
    for (let row = ROWS - 1; row >= 0; row--) {
      const v = f[row * COLS + col];
      if (v !== 0) { f[wi * COLS + col] = v; wi--; }
    }
    for (; wi >= 0; wi--) f[wi * COLS + col] = 0;
  }
}

function simClear(f, combos, cleared) {
  let cl = cleared, again = true;
  while (again) {
    again = false;
    for (let row = 0; row < ROWS; row++) {
      const base = row * COLS;
      for (let ci = 0; ci < combos.length; ci++) {
        if (cl & (1 << ci)) continue;
        const combo = combos[ci], clen = combo.length;
        for (let sc = 0; sc <= COLS - clen; sc++) {
          let hit = true;
          for (let i = 0; i < clen; i++)
            if (f[base + sc + i] !== combo[i]) { hit = false; break; }
          if (hit) {
            for (let i = 0; i < clen; i++) f[base + sc + i] = 0;
            cl |= (1 << ci); again = true;
          }
        }
      }
    }
    if (again) simGravity(f);
  }
  return cl;
}

function popcount(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

// ── BFS 記憶體池（~40MB，每 7 步壓縮一次）──
// 7 步 BFS 從單根最多 ~34 萬狀態，壓縮後 frontier 重新開始
// 500K 池 + 1M 雜湊表已足夠，搭配剪枝+壓縮防溢出
const BFS_POOL_MAX = 500_000;      // 最多 50 萬個狀態
const BFS_HASH_SIZE = 1 << 20;     // 1M 雜湊表（開放定址）
const BFS_HASH_MASK = BFS_HASH_SIZE - 1;
let bfsPool = null;

function initBFSPool() {
  if (bfsPool) return true;
  const TC = ROWS * COLS;
  try {
    bfsPool = {
      TC,
      boards:    new Uint8Array(BFS_POOL_MAX * TC),  // 24MB
      cl:        new Uint32Array(BFS_POOL_MAX),       // 2MB
      parentIdx: new Int32Array(BFS_POOL_MAX),        // 2MB
      firstCol:  new Int8Array(BFS_POOL_MAX),         // 0.5MB
      moveWord:  new Uint8Array(BFS_POOL_MAX),        // 0.5MB
      moveCol:   new Int8Array(BFS_POOL_MAX),         // 0.5MB
      hashTable: new Int32Array(BFS_HASH_SIZE),       // 4MB
      hashGen:   new Uint16Array(BFS_HASH_SIZE),      // 2MB
      frontierA: new Int32Array(BFS_POOL_MAX),        // 2MB
      frontierB: new Int32Array(BFS_POOL_MAX),        // 2MB
      count: 0, gen: 1, fALen: 0, fBLen: 0,
    };
    // Total: ~40MB
    return true;
  } catch (e) {
    bfsPool = null;
    return false;
  }
}

function resetBFSPool() {
  bfsPool.count = 0;
  bfsPool.gen = 1;
  bfsPool.hashGen.fill(0);  // lazy clear: gen(1) !== 0 → all slots empty
  bfsPool.fALen = 0;
  bfsPool.fBLen = 0;
}

function clearAutoPlan() { autoPlan = []; autoPlanStep = 0; }

// 快速猜測：選最空的欄（O(ROWS×COLS)，<0.1ms）
function quickGuessCol() {
  let bestCol = Math.floor(COLS / 2), bestH = -1;
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    for (let r = 0; r < ROWS; r++) {
      if (board[r][c] === null) h++; else break;
    }
    if (h > bestH) { bestH = h; bestCol = c; }
  }
  return bestCol;
}

function findBestColumn() {
  if (!activeBlock) return Math.floor(COLS / 2);
  const word = activeBlock.word;

  // 快取命中 → O(1)
  if (autoPlan.length > 0 && autoPlanStep < autoPlan.length) {
    const planned = autoPlan[autoPlanStep];
    if (planned.word === word) {
      autoPlanStep++;
      return planned.col;
    }
    clearAutoPlan();
  }

  // 啟動背景搜索 + 立刻回傳初步猜測（不凍結）
  runAISearch(word);
  return quickGuessCol();
}

// ── 兩階段搜索：Phase 1 啟發式 + Phase 2 全搜索 BFS ──
// Phase 1: 分析前 7 個字，找出最多字的 combo 優先放底部，其餘 garbage
// Phase 2: 固定 combo 字放固定欄，其餘字全欄嘗試（全搜索 BFS）
//          消除 combo 後漸進剪枝 + 記憶體縮減。Phase 2 在 Phase 1 落子期間偷跑
async function runAISearch(word) {
  const myGen = ++aiSearchGen;
  aiComputing = true;
  buildWordIndex();
  const t0 = performance.now();

  // 確保下一輪佇列已建立，讓 AI 可以看到兩輪
  ensureQueues();
  const fullSeq = [word, ...wordQueue, ...nextWordQueue];
  const seqIdx = Uint8Array.from(fullSeq.map(w => _wToI.get(w) || 0));
  const totalSteps = fullSeq.length;
  const numCombos = comboList.length;
  const TC = ROWS * COLS;

  // 記憶體估算（每個狀態 ≈ board + key string + Map entry + linked list）
  let peakStates = 1;
  function estimateMemoryStr(states) {
    const bytes = states * (TC * 3 + 300);
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + "MB";
    return (bytes / 1024).toFixed(0) + "KB";
  }
  setMessage(`🤖 BFS 0/${totalSteps} | 記憶體 ${estimateMemoryStr(1)}`, true);
  await new Promise(r => setTimeout(r, 0));
  if (myGen !== aiSearchGen) return;

  let initCl = 0;
  for (const ci of clearedCombos) initCl |= (1 << ci);
  const f0 = boardToFlat(board);
  let bestCl = popcount(initCl), bestSp = -1, bestPath = [];
  let ops = 0;
  let lastDebugSample = "";
  let planInstalled = false;

  // ── 偵錯：步驟追蹤 ──
  const debugSteps = []; // [{step, word, inSize, outSize, dedup, pruned, cleared, fixed, mem, event}]
  let debugP1Board = null;     // Phase1 前 7 步後的盤面快照
  let debugP1Steps = [];       // Phase1 各步落點 [{step,word,col,row}]
  let debugFinalBoard = null;  // 目前最佳路徑對應的最終盤面

  // 純文字盤面（供 lastDebugSample 備用）
  function flatToDebugText(flat) {
    const lines = [];
    for (let r = 0; r < ROWS; r++) {
      const cs = [];
      for (let c = 0; c < COLS; c++) {
        const v = flat[r * COLS + c];
        cs.push(v === 0 ? "." : (_iToW[v] || String(v)));
      }
      lines.push(cs.join(" "));
    }
    return lines.join("\n");
  }

  // ── 圖示盤面（box-drawing 格線）──
  // cellW: 每格顯示寬度（半形字元數）；label: 可選覆蓋標籤 Map<r*COLS+c, string>
  function flatToGridText(flat, cellW, label) {
    cellW = cellW || 5;
    const H = "─".repeat(cellW);
    const top = "┌" + Array.from({length:COLS}, () => H).join("┬") + "┐";
    const mid = "├" + Array.from({length:COLS}, () => H).join("┼") + "┤";
    const bot = "└" + Array.from({length:COLS}, () => H).join("┴") + "┘";
    // 欄號標題：對齊每格 cellW 寬 + 1(分隔符)，開頭加 1 格(左框線)
    const hdr = " " + Array.from({length:COLS}, (_, c) => {
      const s = String(c);
      const pad = cellW - s.length;
      const lp = Math.floor(pad / 2), rp = pad - lp;
      return " ".repeat(lp) + s + " ".repeat(rp);
    }).join(" ");

    const rows = [hdr, top];
    for (let r = 0; r < ROWS; r++) {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        let txt;
        if (label && label.has(r * COLS + c)) {
          txt = label.get(r * COLS + c);
        } else {
          const v = flat[r * COLS + c];
          txt = v === 0 ? "" : (_iToW[v] || String(v));
        }
        // 截短 + 置中（純半形）
        if (txt.length > cellW) txt = txt.slice(0, cellW);
        const pad = cellW - txt.length;
        const lp = Math.floor(pad / 2), rp = pad - lp;
        cells.push(" ".repeat(lp) + txt + " ".repeat(rp));
      }
      rows.push("│" + cells.join("│") + "│");
      if (r < ROWS - 1) rows.push(mid);
    }
    rows.push(bot);
    return rows.join("\n");
  }

  // ── 步驟順序圖（用 #1~#7 半形標記，避免全形對齊問題）──
  function stepMapToGridText(steps, cellW) {
    cellW = cellW || 5;
    const flat = new Uint8Array(ROWS * COLS);
    const label = new Map();
    for (const s of steps) {
      if (s.row < 0 || s.row >= ROWS || s.col < 0 || s.col >= COLS) continue;
      const idx = s.row * COLS + s.col;
      // 用 #N 半形標記（保證 monospace 對齊）
      const tag = "#" + s.step;
      const remain = cellW - tag.length;
      // 截短字名填入剩餘空間（至少留 1 字元間隔）
      const w = (s.word || "").slice(0, Math.max(0, remain));
      label.set(idx, tag + w);
    }
    return flatToGridText(flat, cellW, label);
  }

  function buildDebugDiagram() {
    if (!debugMode) return;
    const lines = [];
    lines.push("═══ BFS 搜索狀態 ═══");

    // combo 固定資訊（僅 Phase 1 固定的 priCI）
    if (priCI >= 0) {
      const name = _cIdx[priCI].map(w => _iToW[w]).join(",");
      lines.push("固定: #" + (priCI + 1) + "(" + name + ") → col 0~" + (comboMaxEnd - 1));
    }

    // 找出 bar chart 的最大值（用於縮放）
    let maxSize = 1;
    for (const s of debugSteps) if (s.outSize > maxSize) maxSize = s.outSize;
    const barMax = 20; // bar 最大字元寬度

    // 表頭
    lines.push("步  字       分支圖                  入→出      記憶體    事件");
    lines.push("─".repeat(72));

    for (const s of debugSteps) {
      const barLen = Math.max(1, Math.round(s.outSize / maxSize * barMax));
      const bar = "█".repeat(barLen) + "░".repeat(barMax - barLen);
      const wordStr = (s.word || "?").padEnd(8).slice(0, 8);
      const sizeStr = `${s.inSize}→${s.outSize}`.padEnd(12);
      const memStr = (s.mem || "").padEnd(8);

      let event = "";
      if (s.event) event = s.event;
      else {
        const parts = [];
        if (s.dedup > 0) parts.push(`去重${s.dedup}`);
        if (s.pruned > 0) parts.push(`✂${s.pruned}`);
        if (event === "" && parts.length) event = parts.join(" ");
      }

      const stepStr = String(s.step).padStart(2);
      lines.push(`${stepStr}  ${wordStr} [${bar}] ${sizeStr} ${memStr} ${event}`);
    }

    lines.push("─".repeat(72));
    const fixSummary = priCI >= 0 ? `  固定: #${priCI + 1}` : "";
    lines.push(`最佳: ${bestCl}/${numCombos}${fixSummary}  峰值: ${peakStates}態 ${estimateMemoryStr(peakStates)}`);

    // ── Phase1 前 7 步落點盤面 ──
    if (debugP1Board || debugP1Steps.length > 0) {
      lines.push("\n── Phase1 前 7 步落點 ──");
      if (debugP1Steps.length > 0) {
        lines.push("落點順序 (#N=步驟 初始落點):");
        lines.push(stepMapToGridText(debugP1Steps, 6));
      }
      if (debugP1Board) {
        lines.push("Phase1 結束後盤面 (含消除/重力):");
        lines.push(flatToGridText(debugP1Board, 6));
      }
    }

    // ── 預估最終盤面 ──
    if (debugFinalBoard) {
      lines.push("\n── 預估最終盤面 ──");
      lines.push(flatToGridText(debugFinalBoard, 6));
    }

    // 最新消除樣本
    if (lastDebugSample) {
      lines.push("\n" + lastDebugSample);
    }

    setDebugText(lines.join("\n"));
  }

  // ── 活躍 combo 與字映射 ──
  const activeCI = [];
  for (let ci = 0; ci < numCombos; ci++) if (!(initCl & (1 << ci))) activeCI.push(ci);

  if (activeCI.length === 0) {
    aiComputing = false;
    setMessage(`🤖 BFS 0/${totalSteps} | 記憶體 ${estimateMemoryStr(1)}`, true);
    return;
  }

  const wordToCi = new Int8Array(_iToW.length).fill(-1);
  const wordToPos = new Int8Array(_iToW.length).fill(-1);
  for (const ci of activeCI) {
    const combo = _cIdx[ci];
    for (let p = 0; p < combo.length; p++) {
      if (wordToCi[combo[p]] === -1) {
        wordToCi[combo[p]] = ci;
        wordToPos[combo[p]] = p;
      }
    }
  }

  // ── Phase 1: 掃描 Q 前 7 個字 + 盤面，找出最應優先的 combo ──
  const P1 = Math.min(7, totalSteps);
  const comboFreq = new Uint8Array(numCombos);
  for (let s = 0; s < P1; s++) {
    const ci = wordToCi[seqIdx[s]];
    if (ci >= 0) comboFreq[ci]++;
  }

  // 計算每個 combo 在盤面上已正確放置的字數 + 最佳起始欄
  // boardMatch[ci] = 在最佳起始欄下，已有多少 combo 字在正確位置
  // boardBestStart[ci] = 該 combo 在盤面上匹配最多字的起始欄
  const boardMatch = new Uint8Array(numCombos);
  const boardBestStart = new Uint8Array(numCombos);
  for (const ci of activeCI) {
    const combo = _cIdx[ci];
    const cLen = combo.length;
    let maxM = 0, bestSC = 0;
    for (let sc = 0; sc <= COLS - cLen; sc++) {
      let m = 0;
      for (let p = 0; p < cLen; p++) {
        for (let r = 0; r < ROWS; r++) {
          if (f0[r * COLS + (sc + p)] === combo[p]) { m++; break; }
        }
      }
      if (m > maxM) { maxM = m; bestSC = sc; }
    }
    boardMatch[ci] = maxM;
    boardBestStart[ci] = bestSC;
  }

  // 優先 combo = Q 頻率 + 盤面進度 綜合最高的那組
  // boardMatch 權重較高：盤面已有的字更確定（Q 裡的字還沒放）
  let priCI = -1, priMax = 0;
  for (const ci of activeCI) {
    const score = comboFreq[ci] + boardMatch[ci] * 3;
    if (score > priMax) { priMax = score; priCI = ci; }
  }

  // 根據盤面決定 priCI 的起始欄（不再硬編碼 col 0）
  const wordFixedCol = new Int8Array(_iToW.length).fill(-1);
  let priStartCol = 0;
  let comboMaxEnd = 0;
  if (priCI >= 0) {
    const combo = _cIdx[priCI];
    priStartCol = boardBestStart[priCI];
    comboMaxEnd = priStartCol + combo.length;
    for (let p = 0; p < combo.length; p++) {
      wordFixedCol[combo[p]] = priStartCol + p;
    }
  }

  // 更新最佳結果
  function tryUpdate(finalBoard, clMask, path) {
    const cleared = popcount(clMask);
    let space = 0;
    for (let c = 0; c < COLS; c++)
      for (let r = ROWS - 1; r >= 0; r--)
        if (finalBoard[r * COLS + c] === 0) { space += r + 1; break; }
    if (cleared > bestCl || (cleared === bestCl && space > bestSp)) {
      bestCl = cleared; bestSp = space; bestPath = path;
      autoPlan = path;
      if (!planInstalled) { autoPlanStep = 1; planInstalled = true; }
      if (autoPlanStep <= 1 && path.length > 0) autoTargetCol = path[0].col;
      if (debugMode) {
        debugFinalBoard = finalBoard.slice(); // 儲存最新最佳路徑的最終盤面
        buildDebugDiagram();
      }
      return cleared === numCombos;
    }
    return false;
  }

  const priName = priCI >= 0 ? _cIdx[priCI].map(w => _iToW[w]).join(",") : "無";
  setMessage(`🤖 BFS 0/${totalSteps} | 記憶體 ${estimateMemoryStr(1)}`, true);
  if (debugMode) {
    const comboInfo = activeCI.map(ci => {
      const cLen = _cIdx[ci].length;
      const starts = COLS - cLen + 1;
      const name = _cIdx[ci].map(w => _iToW[w]).join(",");
      if (ci === priCI) return `★${name}(c${priStartCol}~${comboMaxEnd - 1}, 盤面${boardMatch[ci]}字)`;
      return `${name}(${starts}位)`;
    }).join(" ");
    setDebugText(`智慧欄位: combo字分支≈${Math.max(1, COLS - (_cIdx[activeCI[0]]?.length || 3) + 1) + 1}, 垃圾字≈3\n${comboInfo}`);
  }
  await new Promise(r => setTimeout(r, 0));
  if (myGen !== aiSearchGen) return;

  // Phase 1: 啟發式模擬前 P1 步
  const sf = f0.slice();
  let cl = initCl;
  const p1Path = [];
  let p1Ok = true;

  for (let s = 0; s < P1; s++) {
    const wIdx = seqIdx[s];
    const ci = wordToCi[wIdx];
    const fc = wordFixedCol[wIdx];
    let col;

    if (fc >= 0 && ci >= 0 && !(cl & (1 << ci))) {
      col = fc; // combo 字 → 固定欄位
    } else {
        // Garbage → 避開優先 combo 佔用的欄位，從右往左找最空
      let mh = -1; col = COLS - 1;
      for (let c = COLS - 1; c >= 0; c--) {
        // 優先 combo 尚未消除時，跳過它佔用的欄 (priStartCol ~ comboMaxEnd-1)
        if (priCI >= 0 && !(cl & (1 << priCI)) && c >= priStartCol && c < comboMaxEnd) continue;
        let h = 0;
        for (let r = 0; r < ROWS; r++) {
          if (sf[r * COLS + c] === 0) h++; else break;
        }
        if (h > mh) { mh = h; col = c; }
      }
      // fallback：所有非 combo 欄都滿了
      if (mh < 0) {
        for (let c = COLS - 1; c >= 0; c--) {
          let h = 0;
          for (let r = 0; r < ROWS; r++) {
            if (sf[r * COLS + c] === 0) h++; else break;
          }
          if (h > mh) { mh = h; col = c; }
        }
      }
    }

    let lr = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (sf[r * COLS + col] === 0) { lr = r; break; }
    }
    if (lr < 0) { p1Ok = false; break; }

    sf[lr * COLS + col] = wIdx;
    if (debugMode) debugP1Steps.push({ step: s + 1, word: _iToW[wIdx], col, row: lr });
    const bCl = cl;
    const bB = debugMode ? sf.slice() : null;
    cl = simClear(sf, _cIdx, cl);
    const newCleared = popcount(cl) - popcount(bCl);
    if (debugMode && bB && cl !== bCl) {
      lastDebugSample =
        `消除 (+${newCleared} 組)\n` +
        `落: ${_iToW[wIdx]} → col ${col}\n` +
        `消前:\n${flatToDebugText(bB)}\n消後:\n${flatToDebugText(sf)}`;
    }
    // Phase 1 偵錯步驟
    if (debugMode) {
      const isCombo = fc >= 0 && ci >= 0;
      let ev = isCombo ? `c${col}(combo)` : `c${col}(垃圾)`;
      if (newCleared > 0) ev += ` ★消除+${newCleared}`;
      debugSteps.push({
        step: s + 1, word: _iToW[wIdx], inSize: 1, outSize: 1,
        dedup: 0, pruned: 0, cleared: popcount(cl), fixed: 0,
        mem: estimateMemoryStr(1), event: ev
      });
    }
    p1Path.push({ word: fullSeq[s], col });
    setMessage(`🤖 BFS ${s + 1}/${totalSteps} | 記憶體 ${estimateMemoryStr(1)}`, true);
  }

  // Phase 1 結束 → 儲存 Phase1 盤面快照，並用 Phase 1 的結果更新
  if (debugMode) debugP1Board = sf.slice();
  if (p1Ok) tryUpdate(sf, cl, [...p1Path]);

  // ── 偷跑：Phase 1 結束後立即讓出控制權 ──
  // 讓遊戲迴圈開始執行 Phase 1 的落子，Phase 2 在下一個 tick 開始計算
  await new Promise(r => setTimeout(r, 0));
  if (myGen !== aiSearchGen) return;

  if (p1Ok && P1 < totalSteps && bestCl < numCombos) {
    // 偵錯：顯示 Phase 1 完成狀態
    if (debugMode) {
      buildDebugDiagram();
    }

    // ── Phase 2: 全搜索 BFS（記憶體池）──
    // Phase 1 固定的 combo 字只嘗試固定欄，其餘字嘗試所有欄（全搜索）
    // 所有狀態存在預分配的 1GB typed array 池中
    // Phase 2 在 Phase 1 方塊掉落期間即開始計算（偷跑）
    if (!initBFSPool()) {
      setMessage("⚠️ 記憶體池分配失敗（需要 ~40MB）", false);
      aiComputing = false;
      return;
    }
    resetBFSPool();

    const p2Start = P1;
    const p2Len = totalSteps - p2Start;
    let prevBestCleared = popcount(cl);
    let frontierPaths = null; // 壓縮後各 frontier 的前綴路徑（col 陣列）

    // ── 池輔助函數 ──
    function poolHash(board, clMask) {
      let h = 2166136261;
      for (let i = 0; i < TC; i++) { h ^= board[i]; h = Math.imul(h, 16777619); }
      h ^= clMask; h = Math.imul(h, 16777619);
      return h >>> 0;
    }

    // 嘗試插入新狀態，回傳: >=0 新 index, -1 池滿, -2 重複
    function poolInsert(board, clMask, fCol, pIdx, wIdx, col) {
      const hash = poolHash(board, clMask);
      const gen = bfsPool.gen;
      let slot = hash & BFS_HASH_MASK;
      for (let probe = 0; probe < BFS_HASH_SIZE; probe++) {
        if (bfsPool.hashGen[slot] !== gen) {
          // 空槽 → 插入
          const idx = bfsPool.count;
          if (idx >= BFS_POOL_MAX) return -1;
          bfsPool.boards.set(board, idx * TC);
          bfsPool.cl[idx] = clMask;
          bfsPool.firstCol[idx] = fCol;
          bfsPool.parentIdx[idx] = pIdx;
          bfsPool.moveWord[idx] = wIdx;
          bfsPool.moveCol[idx] = col;
          bfsPool.count++;
          bfsPool.hashTable[slot] = idx;
          bfsPool.hashGen[slot] = gen;
          return idx;
        }
        // 已佔用 → 比較
        const eIdx = bfsPool.hashTable[slot];
        if (bfsPool.cl[eIdx] === clMask) {
          const base = eIdx * TC;
          let match = true;
          for (let i = 0; i < TC; i++) {
            if (bfsPool.boards[base + i] !== board[i]) { match = false; break; }
          }
          if (match) return -2; // 重複
        }
        slot = (slot + 1) & BFS_HASH_MASK;
      }
      return -1; // 雜湊表滿（不應發生）
    }

    function poolPath(stateIdx) {
      const moves = [];
      let idx = stateIdx;
      while (idx >= 0 && bfsPool.parentIdx[idx] >= 0) {
        moves.push({ word: _iToW[bfsPool.moveWord[idx]] || "?", col: bfsPool.moveCol[idx] });
        idx = bfsPool.parentIdx[idx];
      }
      moves.reverse();
      // 壓縮後的前綴路徑（從壓縮根往回追）
      let prefix = [];
      if (frontierPaths && idx >= 0 && idx < frontierPaths.length && frontierPaths[idx]) {
        const cols = frontierPaths[idx];
        for (let i = 0; i < cols.length; i++) {
          prefix.push({ word: fullSeq[p2Start + i], col: cols[i] });
        }
      }
      return [...p1Path, ...prefix, ...moves];
    }

    function poolMemStr() {
      const bytes = bfsPool.count * 59;
      const pct = Math.round(bfsPool.count / BFS_POOL_MAX * 100);
      if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}MB (${pct}%)`;
      return `${(bytes / 1024).toFixed(0)}KB (${pct}%)`;
    }

    // ── 預防性剪枝：淘汰弱 frontier 狀態，減緩池增長 ──
    // 不重置池、不需臨時記憶體，parent chain 完整保留
    // 額外記憶體：scores(Float64) + order(Int32) + temp(Int32) ≈ 16 bytes/frontier態
    function pruneFrontier(keepRatio) {
      const fLen = bfsPool.fALen;
      if (fLen <= 1) return 0;
      const keepCount = Math.max(1, Math.floor(fLen * keepRatio));
      if (keepCount >= fLen) return 0;

      // 評分：消除數 * 10000 + 剩餘空間
      const scores = new Float64Array(fLen);
      const order = new Int32Array(fLen);
      for (let i = 0; i < fLen; i++) {
        order[i] = i;
        const idx = bfsPool.frontierA[i];
        const cleared = popcount(bfsPool.cl[idx]);
        let space = 0;
        const base = idx * TC;
        for (let c = 0; c < COLS; c++)
          for (let r = ROWS - 1; r >= 0; r--)
            if (bfsPool.boards[base + r * COLS + c] === 0) { space += r + 1; break; }
        scores[i] = cleared * 10000 + space;
      }

      // 降序排列，保留前 keepCount 個
      order.sort((a, b) => scores[b] - scores[a]);

      // 用臨時陣列重建 frontier（避免覆蓋問題）
      const temp = new Int32Array(keepCount);
      for (let i = 0; i < keepCount; i++) temp[i] = bfsPool.frontierA[order[i]];
      for (let i = 0; i < keepCount; i++) bfsPool.frontierA[i] = temp[i];

      const pruned = fLen - keepCount;
      bfsPool.fALen = keepCount;
      return pruned;
    }

    // ── 記憶體壓縮：重置池，只保留 frontier 狀態 + 前綴路徑 ──
    // 將 frontier 各狀態的 parent chain 轉成 Uint8Array(col) 前綴，
    // 然後清空池、只插回 frontier 為新根。
    // 額外記憶體 ≈ fLen*(TC+4+depth) bytes（臨時，壓縮後即釋放）
    function compactPoolToFrontier() {
      const fLen = bfsPool.fALen;
      if (fLen === 0) return 0;

      // 1) 儲存各 frontier 的完整前綴路徑（僅 col）
      const newPaths = new Array(fLen);
      for (let fi = 0; fi < fLen; fi++) {
        const idx = bfsPool.frontierA[fi];
        const cols = [];
        let cur = idx;
        while (cur >= 0 && bfsPool.parentIdx[cur] >= 0) {
          cols.push(bfsPool.moveCol[cur]);
          cur = bfsPool.parentIdx[cur];
        }
        cols.reverse();
        const ep = (frontierPaths && cur >= 0 && cur < frontierPaths.length && frontierPaths[cur])
          ? frontierPaths[cur] : null;
        const epLen = ep ? ep.length : 0;
        const combined = new Uint8Array(epLen + cols.length);
        if (epLen) combined.set(ep);
        for (let i = 0; i < cols.length; i++) combined[epLen + i] = cols[i];
        newPaths[fi] = combined;
      }

      // 2) 暫存 frontier 盤面 + cl
      const savedBoards = new Uint8Array(fLen * TC);
      const savedCl = new Uint32Array(fLen);
      for (let fi = 0; fi < fLen; fi++) {
        const idx = bfsPool.frontierA[fi];
        const base = idx * TC;
        for (let j = 0; j < TC; j++) savedBoards[fi * TC + j] = bfsPool.boards[base + j];
        savedCl[fi] = bfsPool.cl[idx];
      }

      const oldCount = bfsPool.count;

      // 3) 重置池
      resetBFSPool();

      // 4) 重新插入 frontier 為新根
      for (let fi = 0; fi < fLen; fi++) {
        const base = fi * TC;
        for (let j = 0; j < TC; j++) bfsPool.boards[base + j] = savedBoards[base + j];
        bfsPool.cl[fi] = savedCl[fi];
        bfsPool.parentIdx[fi] = -1;
        bfsPool.firstCol[fi] = -1;
        bfsPool.moveWord[fi] = 0;
        bfsPool.moveCol[fi] = 0;
        bfsPool.frontierA[fi] = fi;
      }
      bfsPool.count = fLen;
      bfsPool.fALen = fLen;

      // 5) 重建雜湊表（僅 frontier）
      for (let fi = 0; fi < fLen; fi++) {
        const hash = poolHash(bfsPool.boards.subarray(fi * TC, (fi + 1) * TC), bfsPool.cl[fi]);
        let slot = hash & BFS_HASH_MASK;
        for (let probe = 0; probe < BFS_HASH_SIZE; probe++) {
          if (bfsPool.hashGen[slot] !== bfsPool.gen) {
            bfsPool.hashTable[slot] = fi;
            bfsPool.hashGen[slot] = bfsPool.gen;
            break;
          }
          slot = (slot + 1) & BFS_HASH_MASK;
        }
      }

      frontierPaths = newPaths;
      return oldCount - fLen;
    }

    // 插入根狀態（Phase 1 結束盤面）
    peakStates = 1;
    const rootIdx = bfsPool.count;
    bfsPool.boards.set(sf, rootIdx * TC);
    bfsPool.cl[rootIdx] = cl;
    bfsPool.firstCol[rootIdx] = -1;
    bfsPool.parentIdx[rootIdx] = -1;
    bfsPool.moveWord[rootIdx] = 0;
    bfsPool.moveCol[rootIdx] = 0;
    bfsPool.count++;
    bfsPool.fALen = 1;
    bfsPool.frontierA[0] = rootIdx;

    // ── 智慧欄位選擇：combo 字只嘗試有效 combo 位置，大幅降低分支因子 ──
    // 例如 5-word combo 在 6 欄中 → 有效起始 = col 0 或 col 1
    // 每個 combo 字只有 2 個有效位置 + 1 垃圾欄 = 3 分支（原本 6）
    const wordComboCols = new Array(_iToW.length).fill(null);
    for (let wi = 1; wi < _iToW.length; wi++) {
      const ci = wordToCi[wi];
      const pos = wordToPos[wi];
      if (ci < 0 || pos < 0 || ci === priCI) continue;
      const cLen = _cIdx[ci].length;
      const starts = COLS - cLen + 1;
      if (starts <= 0) continue;
      const cols = new Uint8Array(starts);
      for (let s = 0; s < starts; s++) cols[s] = s + pos;
      wordComboCols[wi] = cols;
    }
    const tryColsBuf = new Uint8Array(COLS);
    const garbH = new Int8Array(COLS);

    let perfect = false;
    let poolFull = false;
    const YIELD_INTERVAL = 5000;
    const tempBoard = new Uint8Array(TC);

    for (let d = 0; d < p2Len && !perfect && !poolFull; d++) {
      if (myGen !== aiSearchGen) return;

      const wIdx = seqIdx[p2Start + d];

      // 新雜湊代數（本步去重用）
      bfsPool.gen = (bfsPool.gen + 1) & 0xffff;
      if (bfsPool.gen === 0) bfsPool.gen = 1;
      bfsPool.fBLen = 0;

      const wCi = wordToCi[wIdx];
      const fc2 = wordFixedCol[wIdx];
      const cc = wordComboCols[wIdx];  // 非優先 combo 字的有效欄位

      let statesDone = 0;
      const totalInFrontier = bfsPool.fALen;
      let dedupCount = 0;

      for (let fi = 0; fi < bfsPool.fALen && !perfect && !poolFull; fi++) {
        const pIdx = bfsPool.frontierA[fi];
        const pCl = bfsPool.cl[pIdx];
        const pBase = pIdx * TC;
        const pFC = bfsPool.firstCol[pIdx];

        // ── 智慧欄位選擇 ──
        const comboActive = wCi >= 0 && !(pCl & (1 << wCi));
        let tryLen = 0;
        if (fc2 >= 0 && comboActive) {
          // 優先 combo 字 → 固定欄
          tryColsBuf[0] = fc2;
          tryLen = 1;
        } else if (comboActive && cc) {
          // 非優先活躍 combo 字 → 有效 combo 位置 + 最空垃圾欄
          for (let i = 0; i < cc.length; i++) tryColsBuf[tryLen++] = cc[i];
          let bestGC = -1, bestGH = -1;
          for (let c = COLS - 1; c >= 0; c--) {
            let skip = false;
            for (let i = 0; i < cc.length; i++) if (cc[i] === c) { skip = true; break; }
            if (skip) continue;
            let h = 0;
            for (let r = 0; r < ROWS; r++) {
              if (bfsPool.boards[pBase + r * COLS + c] === 0) h++; else break;
            }
            if (h > bestGH) { bestGH = h; bestGC = c; }
          }
          if (bestGC >= 0) tryColsBuf[tryLen++] = bestGC;
        } else {
          // 垃圾字（非 combo 或已消除 combo）→ 最空的 3 欄
          for (let c = 0; c < COLS; c++) {
            garbH[c] = 0;
            for (let r = 0; r < ROWS; r++) {
              if (bfsPool.boards[pBase + r * COLS + c] === 0) garbH[c]++; else break;
            }
          }
          for (let n = 0; n < 3; n++) {
            let best = -1, bestH = 0;
            for (let c = COLS - 1; c >= 0; c--) {
              if (garbH[c] > bestH) { bestH = garbH[c]; best = c; }
            }
            if (best < 0) break;
            tryColsBuf[tryLen++] = best;
            garbH[best] = -1;
          }
        }

        for (let ci_loop = 0; ci_loop < tryLen; ci_loop++) {
          const col = tryColsBuf[ci_loop];
          // 找落點
          let lr = -1;
          for (let r = ROWS - 1; r >= 0; r--) {
            if (bfsPool.boards[pBase + r * COLS + col] === 0) { lr = r; break; }
          }
          if (lr < 0) continue;

          // 複製盤面 + 放字
          for (let i = 0; i < TC; i++) tempBoard[i] = bfsPool.boards[pBase + i];
          tempBoard[lr * COLS + col] = wIdx;

          const bB = debugMode ? tempBoard.slice() : null;
          const nCl = simClear(tempBoard, _cIdx, pCl);
          ops++;

          if (debugMode && bB && nCl !== pCl) {
            lastDebugSample =
              `消除 (+${popcount(nCl) - popcount(pCl)} 組)\n` +
              `落: ${_iToW[wIdx]} → col ${col}\n` +
              `消前:\n${flatToDebugText(bB)}\n消後:\n${flatToDebugText(tempBoard)}`;
          }

          const fCol = pFC >= 0 ? pFC : col;
          const result = poolInsert(tempBoard, nCl, fCol, pIdx, wIdx, col);
          if (result === -2) { dedupCount++; continue; }
          if (result === -1) { poolFull = true; break; }

          bfsPool.frontierB[bfsPool.fBLen++] = result;

          if (popcount(nCl) === numCombos) {
            if (tryUpdate(tempBoard.slice(), nCl, poolPath(result))) { perfect = true; }
            break;
          }
        }

        statesDone++;
        if (statesDone % YIELD_INTERVAL === 0) {
          const pct = Math.round(statesDone / totalInFrontier * 100);
          setMessage(`🤖 BFS ${P1 + d + 1}/${totalSteps} ${pct}% | ${poolMemStr()}`, true);
          await new Promise(r => setTimeout(r, 0));
          if (myGen !== aiSearchGen) return;
        }
      }
      if (perfect) break;

      // 交換 frontier
      const tmpF = bfsPool.frontierA;
      bfsPool.frontierA = bfsPool.frontierB;
      bfsPool.frontierB = tmpF;
      bfsPool.fALen = bfsPool.fBLen;
      peakStates = Math.max(peakStates, bfsPool.count);

      // 找本步最佳狀態
      let stepBestCl = -1, stepBestSp = -1, stepBestIdx = -1;
      for (let fi = 0; fi < bfsPool.fALen; fi++) {
        const idx = bfsPool.frontierA[fi];
        const cleared = popcount(bfsPool.cl[idx]);
        let space = 0;
        const base = idx * TC;
        for (let c = 0; c < COLS; c++)
          for (let r = ROWS - 1; r >= 0; r--)
            if (bfsPool.boards[base + r * COLS + c] === 0) { space += r + 1; break; }
        if (cleared > stepBestCl || (cleared === stepBestCl && space > stepBestSp)) {
          stepBestCl = cleared; stepBestSp = space; stepBestIdx = idx;
        }
      }

      if (stepBestIdx >= 0) {
        const bestBoard = bfsPool.boards.slice(stepBestIdx * TC, (stepBestIdx + 1) * TC);
        tryUpdate(bestBoard, bfsPool.cl[stepBestIdx], poolPath(stepBestIdx));
      }

      // ── 消除剪枝：一旦有狀態消除了新 combo，只保留跟上的狀態 ──
      // BFS 的「頭」從消除成功的狀態重新開始
      let stepPruned = 0;
      let stepEvent = "";
      if (stepBestCl > prevBestCleared) {
        const clDelta = stepBestCl - prevBestCleared;
        prevBestCleared = stepBestCl;
        let wp = 0;
        for (let fi = 0; fi < bfsPool.fALen; fi++) {
          const idx = bfsPool.frontierA[fi];
          // 消除數必須 >= 最佳消除數，沒跟上的全部丟棄
          if (popcount(bfsPool.cl[idx]) < prevBestCleared) { stepPruned++; continue; }
          bfsPool.frontierA[wp++] = idx;
        }
        bfsPool.fALen = wp;
        stepEvent = `★消除+${clDelta} 重置BFS頭 ✂${stepPruned}`;
      }
      // ── 預防性剪枝：根據池使用率，漸進式淘汰弱 frontier 狀態 ──
      const poolUsage = bfsPool.count / BFS_POOL_MAX;
      // 池壓力大時先讓出控制權，避免剪枝+壓縮造成畫面停滯
      if (poolFull || poolUsage > 0.60) {
        await new Promise(r => setTimeout(r, 0));
        if (myGen !== aiSearchGen) return;
      }
      if (poolUsage > 0.90) {
        const p = pruneFrontier(0.25);  // 激進：只保留 25%
        if (p > 0) stepEvent += (stepEvent ? " " : "") + `✂剪枝(90%) -${p}態`;
      } else if (poolUsage > 0.75) {
        const p = pruneFrontier(0.50);  // 適度：保留 50%
        if (p > 0) stepEvent += (stepEvent ? " " : "") + `✂剪枝(75%) -${p}態`;
      } else if (poolUsage > 0.60) {
        const p = pruneFrontier(0.75);  // 輕度：保留 75%
        if (p > 0) stepEvent += (stepEvent ? " " : "") + `✂剪枝(60%) -${p}態`;
      }
      // ── 記憶體壓縮 + 每 7 步決策入 Q ──
      // 每 7 步 BFS 強制壓縮：決策已由 tryUpdate 寫入 autoPlan，
      // 壓縮後釋放記憶體，讓下一輪 7 步可用完整池空間
      const isChunkEnd = ((d + 1) % 7 === 0);
      const needCompress = isChunkEnd
        || (bfsPool.count / BFS_POOL_MAX > 0.50 && bfsPool.count > bfsPool.fALen * 2);
      if (needCompress && bfsPool.count > bfsPool.fALen) {
        const compacted = compactPoolToFrontier();
        if (compacted > 0) {
          const tag = isChunkEnd ? `📦決策入Q` : `🗜️壓縮`;
          stepEvent += (stepEvent ? " " : "") + `${tag}-${compacted}態`;
          poolFull = false;
        }
      }
      if (poolFull) stepEvent += (stepEvent ? " " : "") + "⚠池滿";

      // 偵錯
      if (debugMode) {
        debugSteps.push({
          step: P1 + d + 1, word: _iToW[wIdx],
          inSize: totalInFrontier, outSize: bfsPool.fALen,
          dedup: dedupCount, pruned: stepPruned,
          cleared: stepBestCl, fixed: priCI >= 0 ? 1 : 0,
          mem: poolMemStr(),
          event: stepEvent || (fc2 >= 0 ? "combo" : "")
        });
        buildDebugDiagram();
      }

      setMessage(`🤖 BFS ${P1 + d + 1}/${totalSteps} | ${poolMemStr()}`, true);
      await new Promise(r => setTimeout(r, 0));
      if (myGen !== aiSearchGen) return;
    }

  } // end Phase 2

  if (myGen !== aiSearchGen) return;

  // ── 安裝最佳方案 ──
  if (bestPath.length > 0 && !planInstalled) {
    autoPlan = bestPath;
    autoPlanStep = 1;
    if (bestPath.length > 0) autoTargetCol = bestPath[0].col;
  }
  if (autoTargetCol < 0) autoTargetCol = Math.floor(COLS / 2);

  const elapsed = (performance.now() - t0).toFixed(1);
  const peakMem = bfsPool ? `${(bfsPool.count * 59 / 1048576).toFixed(1)}MB (${Math.round(bfsPool.count / BFS_POOL_MAX * 100)}%)` : estimateMemoryStr(peakStates);
  setMessage(`🤖 BFS ${totalSteps}/${totalSteps} | ${peakMem}`, true);
  if (debugMode) {
    buildDebugDiagram();
    const cur = debugBoxEl.textContent || "";
    const poolInfo = bfsPool ? `, 池 ${bfsPool.count}/${BFS_POOL_MAX}態` : `, 峰值${peakStates}態`;
    setDebugText(cur + `\n\n✅ 計算完成: ${ops}節點, ${elapsed}ms${poolInfo}`);
  }
  aiComputing = false;
}

function toggleAutoMode() {
  if (blockCount < 10) return; // 前 10 子不允許啟用
  autoMode = !autoMode;
  autoBtn.textContent = autoMode ? "手動" : "自動";
  autoBtn.classList.toggle("active", autoMode);
  if (autoMode && activeBlock) {
    aiSearchGen++;
    aiComputing = false;
    clearAutoPlan();
    autoTargetCol = findBestColumn();
    autoLastMoveTime = 0;
  } else {
    aiSearchGen++;
    autoTargetCol = -1;
    aiComputing = false;
    clearAutoPlan();
  }
}

function spawnBlock() {
  const word = nextWord();
  activeBlock = {
    row: 0,
    col: Math.floor(COLS / 2),
    word,
    color: nextWordColor(word),
  };

  blockCount++;

  // 延遲記錄 appear：只有方塊實際被發出時，才記錄該 combo 的 appear
  const toTrack = [];
  for (let ci = 0; ci < comboList.length; ci++) {
    if (_appearedCombos.has(ci)) continue;
    if (comboList[ci].includes(word)) {
      _appearedCombos.add(ci);
      toTrack.push(comboList[ci]);
    }
  }
  if (toTrack.length > 0) trackComboAppear(toTrack);

  if (board[0][activeBlock.col] !== null) {
    running = false;
    setMessage("遊戲結束：方塊堆到最上方", false);
    syncStatsToSheets(); // 遊戲結束時同步統計
    return;
  }

  if (autoMode) {
    autoTargetCol = findBestColumn();
  }
}

function canMoveTo(row, col) {
  if (!activeBlock) return false;
  if (col < 0 || col >= COLS || row >= ROWS) return false;
  return board[row][col] === null;
}

function moveHorizontal(dir) {
  if (!running || !activeBlock || animating) return;
  const nextCol = activeBlock.col + dir;
  if (canMoveTo(activeBlock.row, nextCol)) {
    activeBlock.col = nextCol;
    drawGrid();
  }
}

function hardDrop() {
  if (!running || !activeBlock || animating) return;
  while (canMoveTo(activeBlock.row + 1, activeBlock.col)) {
    activeBlock.row += 1;
  }
  placeActiveBlock();
}

function softDrop() {
  if (!running || !activeBlock || animating) return;
  const nextRow = activeBlock.row + 1;
  if (canMoveTo(nextRow, activeBlock.col)) {
    activeBlock.row = nextRow;
  } else {
    placeActiveBlock();
  }
}

function settleBoardGravity() {
  for (let col = 0; col < COLS; col += 1) {
    const stack = [];
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      if (board[row][col]) stack.push(board[row][col]);
    }
    for (let row = ROWS - 1; row >= 0; row -= 1) {
      board[row][col] = stack[ROWS - 1 - row] || null;
    }
  }
}

function findMatchedGroups() {
  const groups = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (!board[row][col]) continue;
      for (let ci = 0; ci < comboList.length; ci++) {
        const combo = comboList[ci];
        if (col + combo.length > COLS) continue;
        let hit = true;
        for (let i = 0; i < combo.length; i += 1) {
          if (!board[row][col + i] || board[row][col + i].word !== combo[i]) {
            hit = false;
            break;
          }
        }
        if (hit) {
          const cells = combo.map((_, i) => ({ row, col: col + i }));
          groups.push({ cells, comboIndex: ci });
        }
      }
    }
  }
  return groups;
}

// ── 消除特效相關 ──

function spawnParticles(row, col, color) {
  const cx = col * cellSize + cellSize / 2;
  const cy = row * cellSize + cellSize / 2;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 1.5 + Math.random() * 2.5;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 3 + Math.random() * 3,
      color,
      life: 1.0, // 1.0 → 0
    });
  }
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08; // 微重力
    p.life -= 0.03;
    p.r *= 0.97;
  }
  particles = particles.filter((p) => p.life > 0 && p.r > 0.3);
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 閃爍 + 縮小動畫（Promise，播完才繼續）
function playClearAnimation(markedPositions) {
  return new Promise((resolve) => {
    const duration = 420; // ms
    const start = performance.now();

    // 記錄每格的顏色以便畫粒子
    const cellInfos = markedPositions.map(({ row, col }) => ({
      row,
      col,
      color: board[row][col]?.color || "#fff",
    }));

    // 產生粒子
    cellInfos.forEach(({ row, col, color }) => spawnParticles(row, col, color));

    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1); // 0→1

      drawGrid();

      // 在被消除的格子上疊加特效
      for (const { row, col, color } of cellInfos) {
        const x = col * cellSize;
        const y = row * cellSize;
        const shrink = t * (cellSize / 2);

        // 白色閃爍（前半段亮，後半段淡出）
        const flash = t < 0.5 ? 0.7 : 0.7 * (1 - (t - 0.5) * 2);
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(
          x + 1.5 + shrink,
          y + 1.5 + shrink,
          cellSize - 3 - shrink * 2,
          cellSize - 3 - shrink * 2,
        );
      }

      // 粒子已由 drawGrid() 內更新/繪製，不需要重複呼叫

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(tick);
  });
}

function updateProgress() {
  progressEl.textContent = `${clearedCombos.size}/${totalComboCount}`;
}

async function clearMatches() {
  let totalCleared = 0;
  const prevClearedSize = clearedCombos.size;
  const newlyClearedIndices = []; // 本輪新消除的 combo 索引

  while (true) {
    const groups = findMatchedGroups();
    if (!groups.length) break;

    const marked = new Set();
    groups.forEach(({ cells, comboIndex }) => {
      if (!clearedCombos.has(comboIndex)) {
        newlyClearedIndices.push(comboIndex);
      }
      clearedCombos.add(comboIndex);
      cells.forEach(({ row, col }) => marked.add(`${row}-${col}`));
    });

    const positions = [...marked].map((key) => {
      const [row, col] = key.split("-").map(Number);
      return { row, col };
    });

    // 播放消除動畫
    animating = true;
    await playClearAnimation(positions);
    animating = false;

    // 動畫結束後才真正清除
    positions.forEach(({ row, col }) => {
      board[row][col] = null;
    });

    totalCleared += positions.length;
    settleBoardGravity();
    updateProgress();
  }

  if (totalCleared > 0) {
    score += totalCleared;
    scoreEl.textContent = String(score);

    // 清理佇列：已消除 combo 的字不再出現
    purgeWordQueue();

    // 統計：記錄被消除的 combo
    if (newlyClearedIndices.length > 0) {
      trackComboCleared(newlyClearedIndices);
    }

    // 自動移除模式：從 localStorage 移除已消除的 combo
    if (newlyClearedIndices.length > 0) {
      autoRemoveClearedRows(newlyClearedIndices);
    }

    // 從候補區補入新 combo（每消一組補一組）
    const newlyClearedCount = clearedCombos.size - prevClearedSize;
    const added = replenishCombos(newlyClearedCount);
    if (added > 0) {
      // 重建字詞索引（comboList 已增加）
      buildWordIndex();
    }

    // 單字模式：消除後強制重建 queue（只含新的一組 combo，shuffle 後發牌）
    const swMode = isSingleWordMode();
    if (swMode && added > 0) {
      wordQueue = buildWordQueue();
      nextWordQueue = buildWordQueue();
    }

    updateProgress();

    // 檢查是否破關：所有 combo 都已消除且候補區為空
    if (clearedCombos.size >= comboList.length && comboReserve.length === 0) {
      running = false;
      setMessage("🎉 恭喜破關！所有組合都已消除！", true);
      syncStatsToSheets(); // 破關時同步統計
      playClearAllAnimation();
      return;
    }

    let msg = `消除 ${totalCleared} 格（${clearedCombos.size}/${totalComboCount}）`;
    if (swMode && added > 0) {
      // 單字模式：顯示下一組單字的提示
      const nextComboIdx = comboList.findIndex((_, ci) => !clearedCombos.has(ci));
      if (nextComboIdx >= 0) {
        const nextCombo = comboList[nextComboIdx];
        const nextHint = debugMode
          ? nextCombo.join(" ")          // 偵錯模式：中文提示＋德文方塊
          : nextCombo[0];                // 一般模式：只顯示中文提示
        msg += `　▶ 下一組：${nextHint}`;
      }
    } else if (added > 0) {
      const activeCount = comboList.length - clearedCombos.size;
      msg += `　＋${added} 組補入（在場 ${activeCount}，候補 ${comboReserve.length}）`;
    }
    setMessage(msg, true);
  }
}

// 破關慶祝動畫：全畫面放煙火粒子
function playClearAllAnimation() {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const cx = Math.random() * cellSize * COLS;
      const cy = Math.random() * cellSize * ROWS * 0.6;
      for (let j = 0; j < 20; j++) {
        const angle = (Math.PI * 2 * j) / 20 + Math.random() * 0.3;
        const speed = 2 + Math.random() * 3;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 3 + Math.random() * 4,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life: 1.0,
        });
      }
    }, i * 200);
  }
  // 讓粒子持續渲染一段時間
  let frames = 0;
  function celebrateTick() {
    drawGrid();
    frames++;
    if (frames < 120 || particles.length > 0) {
      requestAnimationFrame(celebrateTick);
    }
  }
  requestAnimationFrame(celebrateTick);
}

async function placeActiveBlock() {
  if (!activeBlock) return;
  const { row, col, word, color } = activeBlock;
  board[row][col] = { word, color };

  // ── 計畫過時檢測 ──
  // 若方塊落在非目標欄位，快取計畫失效（盤面已偏離假設）
  if (autoMode && autoPlan.length > 0 && autoTargetCol >= 0 && col !== autoTargetCol) {
    clearAutoPlan();
    aiSearchGen++;    // 取消正在進行的搜索
    aiComputing = false;
  }

  activeBlock = null;
  await clearMatches();
  if (running) spawnBlock();
}

// 將文字拆成多行，只依空白換行，不拆字
function wrapText(text, maxWidth, fontSize) {
  ctx.font = `bold ${fontSize}px sans-serif`;

  // 一行塞得下就不拆
  if (ctx.measureText(text).width <= maxWidth) return [text];

  // 沒有空白 → 不換行，靠縮小字體處理
  const spaceWords = text.split(/\s+/);
  if (spaceWords.length <= 1) return [text];

  // 依空白切行
  const lines = [];
  let current = "";
  for (const w of spaceWords) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// 將文字拆成多行，依字元逐字換行
function wrapTextByChar(text, maxWidth, fontSize) {
  ctx.font = `bold ${fontSize}px sans-serif`;
  const lines = [];
  let current = "";
  for (const ch of text) {
    const test = current + ch;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCell(row, col, cellData) {
  const x = col * cellSize;
  const y = row * cellSize;
  ctx.fillStyle = cellData.color;
  ctx.fillRect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.strokeRect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);

  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = cellSize - 6;
  const isCN = /[\u4e00-\u9fff]/.test(cellData.word);
  const minFont = isCN ? 12 : 11;
  let fontSize = Math.max(minFont, Math.floor(cellSize * 0.28));
  ctx.font = `bold ${fontSize}px sans-serif`;

  // 第 1 步：空白換行
  let lines = wrapText(cellData.word, maxWidth, fontSize);

  // 第 2 步：仍塞不下 → 縮小字體（到最小值為止）
  while (
    lines.some((line) => ctx.measureText(line).width > maxWidth) &&
    fontSize > minFont
  ) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = wrapText(cellData.word, maxWidth, fontSize);
  }

  // 第 3 步：縮到最小仍塞不下 → 逐字換行
  if (lines.some((line) => ctx.measureText(line).width > maxWidth)) {
    lines = wrapTextByChar(cellData.word, maxWidth, fontSize);
  }

  const lineHeight = fontSize + 2;

  // 超出格子的不顯示：只保留塞得進格高的行數（字級/換行邏輯維持原樣）
  const maxLines = Math.max(1, Math.floor((cellSize - 4) / lineHeight));
  const visibleLines = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const totalHeight = visibleLines.length * lineHeight;
  const startY = y + cellSize / 2 - totalHeight / 2 + lineHeight / 2;

  // 以格子為裁切範圍，任何畫到格子外的文字一律不顯示
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);
  ctx.clip();
  visibleLines.forEach((line, i) => {
    ctx.fillText(line, x + cellSize / 2, startY + i * lineHeight);
  });
  ctx.restore();
}

function drawGrid() {
  ctx.clearRect(0, 0, cellSize * COLS, cellSize * ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.strokeRect(col * cellSize, row * cellSize, cellSize, cellSize);
      if (board[row][col]) drawCell(row, col, board[row][col]);
    }
  }
  if (activeBlock) drawCell(activeBlock.row, activeBlock.col, activeBlock);

  // 持續畫殘留粒子
  if (particles.length) {
    updateParticles();
    drawParticles();
  }
}

function gameLoop(ts) {
  if (!running) {
    drawGrid();
    return;
  }

  // 動畫播放中 → 暫停掉落（AI 計算中不再凍結）
  if (animating) {
    lastTick = ts;
  } else {
    if (!lastTick) lastTick = ts;
    // 自動模式掉落稍快（350ms），手動維持原速（550ms）
    const fallSpeed = autoMode ? 350 : FALL_MS;
    if (ts - lastTick >= fallSpeed) {
      softDrop();
      lastTick = ts;
    }

    // 自動模式：水平移動 + 到達目標欄後額外加速
    if (autoMode && activeBlock) {
      if (autoTargetCol < 0) autoTargetCol = findBestColumn();
      if (autoTargetCol >= 0 && activeBlock.col !== autoTargetCol
          && ts - autoLastMoveTime >= AUTO_MOVE_MS) {
        moveHorizontal(activeBlock.col < autoTargetCol ? 1 : -1);
        autoLastMoveTime = ts;
      } else if (autoTargetCol >= 0 && activeBlock.col === autoTargetCol && !aiComputing) {
        // 已到目標欄且計算完成 → 額外加速落下
        softDrop();
      }
    }
  }

  drawGrid();
  gameLoopId = requestAnimationFrame(gameLoop);
}

function restartGame() {
  // 重新開始前，先同步統計到 Google Sheets
  syncStatsToSheets();

  // 重新從 localStorage 讀取群組資料與最新的 word 資料
  groupData = loadGroupData();
  ALL_WORD_ROWS = loadWordRows();
  allComboList = buildComboList(ALL_WORD_ROWS);

  // 字母模式：根據最長 combo 動態調整 COLS（上限 14）
  const prevCols = COLS;
  if (isSingleWordMode() && loadSplitMode() === "letter") {
    const maxLen = allComboList.reduce((m, c) => Math.max(m, c.length), 0);
    COLS = Math.max(6, Math.min(maxLen, 14));
  } else {
    COLS = 6;
  }
  if (COLS !== prevCols) {
    bfsPool = null;
    resizeCanvas();
  }

  // 每次重新開始都重新抽取並分配在場/候補
  initComboPool();

  board = createEmptyBoard();
  activeBlock = null;
  score = 0;
  lastTick = 0;
  running = true;
  clearedCombos = new Set();
  _appearedCombos = new Set();
  particles = [];
  wordQueue = [];
  nextWordQueue = [];
  autoTargetCol = -1;
  autoLastMoveTime = 0;
  blockCount = 0;
  aiSearchGen++;            // 取消舊搜索
  aiComputing = false;
  clearAutoPlan();
  // 重讀偵錯模式（可能在設定頁面改過）
  initDebugMode();
  // 重置自動模式
  autoMode = false;
  autoBtn.textContent = "自動";
  autoBtn.classList.remove("active");
  scoreEl.textContent = "0";
  updateProgress();

  const swMode = isSingleWordMode();
  if (swMode && comboList.length > 0) {
    const firstCombo = comboList[0];
    const comboHint = debugMode
      ? firstCombo.join(" ")          // 偵錯模式：中文提示＋德文方塊
      : firstCombo[0];                // 一般模式：只顯示中文提示
    setMessage(`🔤 單字模式（共 ${totalComboCount} 組）▶ ${comboHint}`, true);
  } else {
    const activeInfo = `在場 ${comboList.length} 組`;
    const reserveInfo = comboReserve.length > 0
      ? `，候補 ${comboReserve.length} 組`
      : "";
    setMessage(`遊戲開始（共 ${totalComboCount} 組，${activeInfo}${reserveInfo}），左/右移動，下鍵直接落地`, true);
  }

  spawnBlock();
  cancelAnimationFrame(gameLoopId);
  gameLoopId = requestAnimationFrame(gameLoop);
}

function bindControls() {
  tapBind(leftBtn, () => { if (!autoMode) moveHorizontal(-1); });
  tapBind(rightBtn, () => { if (!autoMode) moveHorizontal(1); });
  tapBind(downBtn, () => { if (!autoMode) hardDrop(); });
  tapBind(restartBtn, restartGame);

  window.addEventListener("keydown", (event) => {
    if (autoMode) return;
    if (event.key === "ArrowLeft") moveHorizontal(-1);
    if (event.key === "ArrowRight") moveHorizontal(1);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      hardDrop();
    }
  });

  bindBoardTouch();
}

// ── 盤面觸控（iPhone）：點左/右半邊移動、向下滑直接落地 ──
function bindBoardTouch() {
  let startX = 0;
  let startY = 0;
  let startTime = 0;

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    if (autoMode || !running || animating) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const dt = Date.now() - startTime;

    // 快速下滑 → 直接落地
    if (dy > 44 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      hardDrop();
      return;
    }
    // 水平滑動 → 每 36px 移一格
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
      const steps = Math.min(COLS, Math.max(1, Math.round(Math.abs(dx) / 36)));
      for (let i = 0; i < steps; i++) moveHorizontal(dx > 0 ? 1 : -1);
      return;
    }
    // 輕點 → 依點擊在盤面左/右半邊移動一格
    if (dt < 300 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const rect = canvas.getBoundingClientRect();
      const relX = touch.clientX - rect.left;
      moveHorizontal(relX < rect.width / 2 ? -1 : 1);
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
}

function init() {
  preventZoom();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  bindControls();
  restartGame();
}

init();

