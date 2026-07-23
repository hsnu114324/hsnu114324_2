const loadCustomActive = isCustomActive;
const loadSingleWordMode = isSingleWordMode;


// ── 單字資料（由 loadWordData() 從 JSON 載入） ──

let GROUP_WORDS1 = [];
let GROUP_WORDS2 = [];
let GROUP_WORDS3 = [];
let GROUP_WORDS4 = [];
let GROUP_WORDS5 = [];
let SENTENCE_ROWS = [];
let SENTENCE_CATEGORIES = [];
let GROUP_ALL = [];
let DEFAULT_WORD_ROWS = [];

function getSentenceCategoryId(index) {
  for (const cat of SENTENCE_CATEGORIES) {
    if (index >= cat.start && index <= cat.end) return cat.id;
  }
  return null;
}

function getFilteredSentenceRows(activeCats) {
  if (!activeCats) return SENTENCE_ROWS;
  return SENTENCE_ROWS.filter((_, i) => {
    const catId = getSentenceCategoryId(i);
    return catId && activeCats.has(catId);
  });
}



// ── 字母子群組工具 ──

/** 從 word row 提取德文首字母（去除冠詞，合併 Ä→A, Ö→O, Ü→U） */
function getGermanFirstLetter(row) {
  const parts = row.split(",");
  if (parts.length < 2) return null;
  let german = parts[1].trim();
  // 去除常見德文冠詞
  german = german.replace(/^(der|die|das|den|dem|ein|eine|einen|einem|einer)\s+/i, "");
  if (!german) return null;
  let ch = german.charAt(0).toUpperCase();
  // 合併變母音
  if (ch === "Ä") ch = "A";
  if (ch === "Ö") ch = "O";
  if (ch === "Ü") ch = "U";
  return /[A-Z]/.test(ch) ? ch : null;
}

/** 將 DEFAULT_WORD_ROWS 按德文首字母分組 */
function buildLetterMap() {
  const map = {};
  for (const row of DEFAULT_WORD_ROWS) {
    const parts = row.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length !== 2) continue;
    const letter = getGermanFirstLetter(row);
    if (!letter) continue;
    if (!map[letter]) map[letter] = [];
    map[letter].push(row);
  }
  return map;
}

let _letterMap = {};
let _lettersSorted = [];

// ── 通用群組分類系統 ──

let GROUP_CATEGORIES_CONFIG = {};

function buildGroupCategoriesConfig() {
  return {
    1: {
      label: "速記單字：字母分類",
      storageKey: "word_tetris_group2_letter_cats_v1",
      cats: (() => {
        const letters = new Set();
        for (const row of GROUP_WORDS2) {
          const parts = row.split(",");
          if (parts.length < 2) continue;
          let ch = parts[1].trim().charAt(0).toUpperCase();
          if (ch === "Ä") ch = "A";
          if (ch === "Ö") ch = "O";
          if (ch === "Ü") ch = "U";
          if (/[A-Z]/.test(ch)) letters.add(ch);
        }
        return [...letters].sort().map(l => ({ id: l, label: l }));
      })(),
      getCategory(row) {
        const parts = row.split(",");
        if (parts.length < 2) return null;
        let ch = parts[1].trim().charAt(0).toUpperCase();
        if (ch === "Ä") ch = "A";
        if (ch === "Ö") ch = "O";
        if (ch === "Ü") ch = "U";
        return /[A-Z]/.test(ch) ? ch : null;
      },
    },
    2: {
      label: "名詞詞性：分類",
      storageKey: "word_tetris_group3_cats_v1",
      cats: [
        { id: "der", label: "陽性 (der)" },
        { id: "das", label: "中性 (das)" },
        { id: "die", label: "陰性 (die)" },
        { id: "pl",  label: "複數 (pl.)" },
      ],
      getCategory(row) {
        const first = row.split(",")[0].trim();
        if (first.startsWith("der ")) return "der";
        if (first.startsWith("das ")) return "das";
        if (first.startsWith("die ")) return "die";
        if (first.startsWith("pl.")) return "pl";
        return null;
      },
    },
    3: {
      label: "冠詞＋名詞：詞性分類",
      storageKey: "word_tetris_group4_cats_v1",
      cats: [
        { id: "masculine", label: "陽性" },
        { id: "neuter",    label: "中性" },
        { id: "feminine",  label: "陰性" },
        { id: "plural",    label: "複數" },
      ],
      getCategory(row) {
        const first = row.split(",")[0].trim();
        if (first.startsWith("陽性")) return "masculine";
        if (first.startsWith("中性")) return "neuter";
        if (first.startsWith("陰性")) return "feminine";
        if (first.startsWith("複數")) return "plural";
        return null;
      },
    },
    4: {
      label: "形容詞變化：詞性分類",
      storageKey: "word_tetris_group5_cats_v1",
      cats: [
        { id: "masculine", label: "陽性" },
        { id: "neuter",    label: "中性" },
        { id: "feminine",  label: "陰性" },
        { id: "plural",    label: "複數" },
      ],
      getCategory(row) {
        const first = row.split(",")[0].trim();
        if (first.startsWith("陽性")) return "masculine";
        if (first.startsWith("中性")) return "neuter";
        if (first.startsWith("陰性")) return "feminine";
        if (first.startsWith("複數")) return "plural";
        return null;
      },
    },
  };
}

/** 取得群組分類 id（通用） */
function getGroupCategory(groupIdx, row) {
  const config = GROUP_CATEGORIES_CONFIG[groupIdx];
  return config ? config.getCategory(row) : null;
}

/** 載入某群組已選的分類集合；null = 全選 */
function loadGroupCats(groupIdx) {
  const config = GROUP_CATEGORIES_CONFIG[groupIdx];
  if (!config) return null;
  try {
    const raw = localStorage.getItem(config.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    return null;
  } catch { return null; }
}

/** 載入已選的字母集合；null = 全選 */
function loadActiveLetters() {
  try {
    const raw = localStorage.getItem(WORD_LETTERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    return null;
  } catch { return null; }
}

/** 載入句子分類篩選；null = 全選 */
function loadSentenceCats() {
  try {
    const raw = localStorage.getItem(SENTENCE_CATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    return null;
  } catch { return null; }
}

async function loadWordData() {
  try {
    // 字庫由 data/words.js 以 <script> 載入（支援 file:// 直接開啟）
    const data = window.WORD_DATA;
    if (!data) throw new Error("window.WORD_DATA 不存在（data/words.js 未載入）");
    GROUP_WORDS1 = data.groups[0];
    GROUP_WORDS2 = data.groups[1];
    GROUP_WORDS3 = data.groups[2];
    GROUP_WORDS4 = data.groups[3];
    GROUP_WORDS5 = data.groups[4];
    GROUP_ALL = data.groups;
    SENTENCE_ROWS = (data.sentences && data.sentences.rows) || [];
    SENTENCE_CATEGORIES = (data.sentences && data.sentences.categories) || [];
    DEFAULT_WORD_ROWS = data.vocabulary;
  } catch (e) {
    console.error('載入單字資料失敗:', e);
    GROUP_ALL = [[], [], [], [], []];
    DEFAULT_WORD_ROWS = ["轉彎,abbiegen", "垃圾,der Abfall"];
  }
}

const rowListEl = document.getElementById("rowList");
const messageEl = document.getElementById("message");
const newRowInput = document.getElementById("newRowInput");
const addBtn = document.getElementById("addBtn");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const pickCountInput = document.getElementById("pickCount");
const totalCountEl = document.getElementById("totalCount");
const debugToggle = document.getElementById("debugToggle");
const autoRemoveToggle = document.getElementById("autoRemoveToggle");
const battleModeToggle = document.getElementById("battleModeToggle");
const len2Toggle = document.getElementById("len2Toggle");
const len3Toggle = document.getElementById("len3Toggle");
const len4Toggle = document.getElementById("len4Toggle");
const len5Toggle = document.getElementById("len5Toggle");
const groupBtnBar = document.getElementById("groupBtnBar");
const groupBtns = groupBtnBar.querySelectorAll(".group-btn[data-group]");
const customSourceBtn = document.getElementById("customSourceBtn");
const customInputArea = document.getElementById("customInputArea");
const singleWordModeBtn = document.getElementById("singleWordModeBtn");
const lenSection = document.getElementById("lenSection");
const sourceSection = document.getElementById("sourceSection");
const singleWordModeHint = document.getElementById("singleWordModeHint");
const letterSubgroupBar = document.getElementById("letterSubgroupBar");
const sentenceCatBar = document.getElementById("sentenceCatBar");
const groupCatBarsContainer = document.getElementById("groupCatBars");
const splitModeBar = document.getElementById("splitModeBar");
const splitModeBtns = splitModeBar ? splitModeBar.querySelectorAll(".split-mode-btn") : [];

// ── 資料 ──
let customRows = [];
let customRowsFull = [];
let displayRows = [];
let pickCount = 0;
let activeGroups = new Set();
let customActive = false;
let singleWordMode = false;
let sentenceMode = false;
let activeSentenceCats = null;
let splitMode = "syllable";
let activeLetters = null;
let activeGroupCats = {};

// （單字模式關閉後保持 2格+自定義，不需要記憶先前設定）

// ── 偵錯工具 ──

function _isDebug() {
  return localStorage.getItem(DEBUG_KEY) === "1";
}

/** 在 debug 模式下攔截 localStorage 寫入，追蹤 CUSTOM_FULL_KEY 異常縮減 */
function _installStorageMonitor() {
  if (window._storageMonitorInstalled) return;
  window._storageMonitorInstalled = true;
  const orig = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    if (_isDebug() && key === CUSTOM_FULL_KEY) {
      try {
        const arr = JSON.parse(value);
        const count = Array.isArray(arr) ? arr.length : "?";
        console.log(`%c[localStorage] ${key} 寫入 ${count} 筆`, "color:#ff9800", new Error().stack.split("\n")[2]);
      } catch {}
    }
    return orig(key, value);
  };
}
_installStorageMonitor();

// ── 工具 ──
function normalizeRowString(row) {
  return row
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

// ── 載入 ──
function loadCustomRows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_WORD_ROWS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_WORD_ROWS];
    const validRows = parsed
      .map((row) => normalizeRowString(String(row)))
      .filter(isValidRowString);
    return validRows.length ? validRows : [...DEFAULT_WORD_ROWS];
  } catch (error) {
    return [...DEFAULT_WORD_ROWS];
  }
}

function loadAllowedLens() {
  try {
    const raw = localStorage.getItem(LENS_KEY);
    if (!raw) return [2, 3, 4, 5];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return [2, 3, 4, 5];
  } catch { return [2, 3, 4, 5]; }
}

function loadActiveGroups() {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter(n => n >= 0 && n < GROUP_ALL.length));
    return new Set();
  } catch { return new Set(); }
}

/** 載入自定義 word 的完整快照（不受 save 截斷影響） */
function loadCustomRowsFull() {
  try {
    const raw = localStorage.getItem(CUSTOM_FULL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed
          .map(r => normalizeRowString(String(r)))
          .filter(isValidRowString);
        if (valid.length > 0) return valid;
      }
    }
  } catch (e) { /* ignore */ }
  // 若 CUSTOM_FULL_KEY 不存在，以 DEFAULT_WORD_ROWS 為完整來源
  return [...DEFAULT_WORD_ROWS];
}

/** 持久化完整快照到 localStorage */
function saveCustomRowsFull() {
  localStorage.setItem(CUSTOM_FULL_KEY, JSON.stringify(customRowsFull));
  updateDebugPoolStatus();
}

// ── 顯示列表管理 ──

/** 根據目前的 activeGroups + customActive 建立 displayRows */
function buildDisplayRows() {
  displayRows = [];

  // 單字模式：強制 2格 + 自定義，只載入 2 欄項目，支援字母篩選
  if (singleWordMode) {
    customActive = true;
    activeGroups = new Set();
    len2Toggle.checked = true;
    len3Toggle.checked = false;
    len4Toggle.checked = false;
    len5Toggle.checked = false;

    for (const w of customRowsFull) {
      const parts = w.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      // 字母篩選
      if (activeLetters !== null) {
        const letter = getGermanFirstLetter(w);
        if (!letter || !activeLetters.has(letter)) continue;
      }
      displayRows.push({ text: w, source: "custom" });
    }
    return;
  }

  // ── 非單字模式的正常流程 ──
  // 讀取已移除的群組 word 記錄（含手動移除 + 自動移除）
  const removed = loadGroupRemoved();
  for (const gi of activeGroups) {
    const removedSet = new Set(
      (removed[gi] || []).map(s => s.split(",").map(p => p.trim().toLowerCase()).filter(Boolean).join(","))
    );
    for (const w of GROUP_ALL[gi]) {
      const norm = w.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
      if (removedSet.has(norm)) continue;
      // 通用群組分類篩選
      const _catConfig = GROUP_CATEGORIES_CONFIG[gi];
      if (_catConfig && activeGroupCats[gi] !== null && activeGroupCats[gi] !== undefined) {
        const cat = _catConfig.getCategory(w);
        if (cat && !activeGroupCats[gi].has(cat)) continue;
      }
      displayRows.push({ text: w, source: "group-" + gi });
    }
  }
  if (customActive) {
    for (const w of customRows) {
      displayRows.push({ text: w, source: "custom" });
    }
  }
}

const GROUP_NAMES = ["B1 單字", "速記單字", "名詞詞性", "冠詞＋名詞", "形容詞變化"];

function sourceLabel(source) {
  if (source === "custom") return "[自定義]";
  const idx = parseInt(source.split("-")[1], 10);
  return "[" + (GROUP_NAMES[idx] || "群" + (idx + 1)) + "]";
}

function updateTotalCount() {
  const total = sentenceMode
    ? getFilteredSentenceRows(activeSentenceCats).length
    : displayRows.length;
  totalCountEl.textContent = String(total);
  pickCountInput.max = total;
  if (pickCount > total) {
    pickCount = total;
    pickCountInput.value = pickCount;
  }
  updateDebugPoolStatus();
}

function updateDebugPoolStatus() {
  const el = document.getElementById("debugPoolStatus");
  if (!el) return;
  if (!_isDebug()) { el.style.display = "none"; return; }
  el.style.display = "block";
  const fullLen = customRowsFull.length;
  const vocabLen = DEFAULT_WORD_ROWS.length;
  const dispLen = displayRows.filter(r => r.source === "custom").length;
  const pct = vocabLen > 0 ? ((fullLen / vocabLen * 100) | 0) : "?";
  const color = pct > 80 ? "#4caf50" : pct > 40 ? "#ff9800" : "#f44336";
  el.innerHTML =
    `<span style="color:${color}">■</span> 單字池：${fullLen}/${vocabLen}（${pct}%）` +
    ` ｜ 目前顯示：${dispLen}` +
    (activeLetters ? ` ｜ 字母篩選：${[...activeLetters].sort().join("")}` : "") +
    ` ｜ STORAGE_KEY：${(() => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r).length : 0; } catch { return "?"; } })()}`;
}

function setMessage(text, ok = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("ok", ok);
}

const PAGE_SIZE = 50;
let renderedCount = 0;

function renderRows() {
  rowListEl.innerHTML = "";
  renderedCount = 0;

  if (!displayRows.length) {
    const empty = document.createElement("div");
    empty.className = "row-item";
    empty.innerHTML = "<span>請點選上方按鈕載入單字來源</span>";
    rowListEl.appendChild(empty);
    updateTotalCount();
    return;
  }

  renderMoreRows();
  updateTotalCount();
}

function renderMoreRows() {
  const end = Math.min(renderedCount + PAGE_SIZE, displayRows.length);

  const oldMore = rowListEl.querySelector(".load-more-btn");
  if (oldMore) oldMore.remove();

  const frag = document.createDocumentFragment();
  for (let i = renderedCount; i < end; i++) {
    const item = document.createElement("div");
    item.className = "row-item";
    item.dataset.idx = i;

    const label = document.createElement("span");
    label.className = "source-label";
    label.textContent = sourceLabel(displayRows[i].source);
    label.style.cssText = "color:#7ea6ff;font-size:12px;margin-right:6px;white-space:nowrap;";

    const content = document.createElement("code");
    content.textContent = displayRows[i].text;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.className = "danger remove-row-btn";

    item.appendChild(label);
    item.appendChild(content);
    item.appendChild(removeBtn);
    frag.appendChild(item);
  }
  rowListEl.appendChild(frag);
  renderedCount = end;

  if (renderedCount < displayRows.length) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "load-more-btn";
    moreBtn.textContent = `載入更多（已顯示 ${renderedCount}/${displayRows.length}）`;
    moreBtn.style.cssText = "width:100%;padding:12px;margin-top:8px;font-size:15px;cursor:pointer;";
    tapBind(moreBtn, () => renderMoreRows());
    rowListEl.appendChild(moreBtn);
  }
}

// 事件委派：統一處理「移除」按鈕
function handleRemoveRow(e) {
  const btn = e.target.closest(".remove-row-btn");
  if (!btn) return;
  if (e.type === "touchstart") e.preventDefault();
  const item = btn.closest(".row-item");
  if (!item) return;
  const idx = parseInt(item.dataset.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= displayRows.length) return;
  displayRows.splice(idx, 1);
  renderRows();
  setMessage("已移除一列，按「儲存」生效。");
}
rowListEl.addEventListener("click", handleRemoveRow);
rowListEl.addEventListener("touchstart", handleRemoveRow, { passive: false });

// ── 切換來源 ──

function toggleGroup(idx) {
  const key = "group-" + idx;
  if (activeGroups.has(idx)) {
    // 關閉：從 displayRows 移除該群組的項目
    activeGroups.delete(idx);
    displayRows = displayRows.filter(r => r.source !== key);
  } else {
    // 開啟：載入該群組的 word（套用分類篩選）
    activeGroups.add(idx);
    const catConfig = GROUP_CATEGORIES_CONFIG[idx];
    const cats = activeGroupCats[idx];
    for (const w of GROUP_ALL[idx]) {
      if (catConfig && cats !== null && cats !== undefined) {
        const cat = catConfig.getCategory(w);
        if (cat && !cats.has(cat)) continue;
      }
      displayRows.push({ text: w, source: key });
    }
  }
  // 更新分類按鈕列
  updateGroupCatBarsVisibility();
  updateSourceUI();
  renderRows();
}

/** 將 displayRows 中目前的 custom 項目同步回 customRowsFull / customRows，
 *  確保手動移除的項目不會在模式切換時「復活」。
 *  ⚠ 單字模式＋字母篩選時，被篩選隱藏的單字不應被移除，只移除使用者明確刪除的。 */
function syncCustomFullFromDisplay() {
  const hasCustomInDisplay = displayRows.some(r => r.source === "custom");
  if (!hasCustomInDisplay && !customActive) return;

  const before = customRowsFull.length;

  const currentCustomNorms = new Set(
    displayRows
      .filter(r => r.source === "custom")
      .map(r => r.text.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(","))
  );
  customRowsFull = customRowsFull.filter(w => {
    const norm = w.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
    if (currentCustomNorms.has(norm)) return true;
    if (singleWordMode && activeLetters !== null) {
      const parts = w.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length !== 2) return true;
      const letter = getGermanFirstLetter(w);
      if (!letter || !activeLetters.has(letter)) return true;
    }
    return false;
  });

  const after = customRowsFull.length;
  const dropRate = before > 0 ? (before - after) / before : 0;
  if (dropRate > 0.5 && before > 10) {
    console.warn(
      `[syncCustomFull] 單字池異常縮減 ${before} → ${after}（-${((dropRate * 100)|0)}%）`,
      { singleWordMode, activeLetters: activeLetters ? [...activeLetters] : null }
    );
  }
  if (_isDebug()) {
    console.log(`[syncCustomFull] ${before} → ${after}（移除 ${before - after}）`);
  }

  customRows = [...customRowsFull];
  saveCustomRowsFull();
}

function toggleCustom() {
  if (customActive) {
    // 關閉前：同步手動移除到 customRowsFull
    syncCustomFullFromDisplay();
    customActive = false;
    // 若單字模式仍開啟，也一併關閉
    if (singleWordMode) singleWordMode = false;
    displayRows = displayRows.filter(r => r.source !== "custom");
  } else {
    // 開啟：從完整快照重載
    customActive = true;
    for (const w of customRowsFull) {
      displayRows.push({ text: w, source: "custom" });
    }
  }
  updateSourceUI();
  renderRows();
}

// ── 通用群組分類 UI ──

/** 渲染指定群組的分類按鈕列 */
function renderGroupCatBar(groupIdx) {
  const config = GROUP_CATEGORIES_CONFIG[groupIdx];
  if (!config || !groupCatBarsContainer) return;

  // 找到或建立該群組的 bar
  let bar = groupCatBarsContainer.querySelector(`[data-group-cat="${groupIdx}"]`);
  if (!bar) {
    bar = document.createElement("div");
    bar.dataset.groupCat = groupIdx;
    bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;justify-content:center;";
    // 標題
    const title = document.createElement("span");
    title.style.cssText = "font-size:0.78rem;color:#999;width:100%;text-align:center;margin-bottom:2px;";
    title.textContent = config.label;
    bar.appendChild(title);
    groupCatBarsContainer.appendChild(bar);
  }

  // 清除現有按鈕（保留標題 span）
  const title = bar.querySelector("span");
  bar.innerHTML = "";
  if (title) bar.appendChild(title);

  // 「全部」按鈕
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "全部";
  allBtn.className = "gcat-btn";
  allBtn.dataset.cat = "ALL";
  allBtn.dataset.groupIdx = groupIdx;
  allBtn.style.cssText = "padding:8px 14px;font-size:0.85rem;font-weight:700;" +
    "border:2px solid #666;border-radius:8px;background:#2a2a2a;color:#ccc;" +
    "cursor:pointer;transition:background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s;";
  bar.appendChild(allBtn);

  for (const cat of config.cats) {
    const count = GROUP_ALL[groupIdx].filter(w => config.getCategory(w) === cat.id).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${cat.label} (${count})`;
    btn.className = "gcat-btn";
    btn.dataset.cat = cat.id;
    btn.dataset.groupIdx = groupIdx;
    btn.style.cssText = "padding:8px 14px;font-size:0.85rem;font-weight:600;" +
      "border:2px solid #666;border-radius:8px;background:#2a2a2a;color:#ccc;" +
      "cursor:pointer;transition:background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s;";
    bar.appendChild(btn);
  }

  // 綁定事件
  bar.querySelectorAll(".gcat-btn").forEach(btn => {
    tapBind(btn, () => toggleGroupCat(parseInt(btn.dataset.groupIdx), btn.dataset.cat));
  });

  updateGroupCatBarUI(groupIdx);
}

/** 切換指定群組的分類 */
function toggleGroupCat(groupIdx, catId) {
  const config = GROUP_CATEGORIES_CONFIG[groupIdx];
  if (!config) return;
  const allCatIds = config.cats.map(c => c.id);
  let cats = activeGroupCats[groupIdx];

  if (catId === "ALL") {
    cats = (cats === null || cats === undefined) ? new Set() : null;
  } else {
    if (cats === null || cats === undefined) {
      cats = new Set(allCatIds);
      cats.delete(catId);
    } else if (cats.has(catId)) {
      cats.delete(catId);
      if (cats.size === 0) cats = null;
    } else {
      cats.add(catId);
      if (cats.size >= allCatIds.length) cats = null;
    }
  }

  activeGroupCats[groupIdx] = cats;

  // 重建該群組的 displayRows
  rebuildGroupDisplay(groupIdx);
  updateGroupCatBarUI(groupIdx);
  renderRows();

  const sourceKey = "group-" + groupIdx;
  const count = displayRows.filter(r => r.source === sourceKey).length;
  const groupLabel = GROUP_NAMES[groupIdx] || ("群組 " + (groupIdx + 1));
  if (cats === null || cats === undefined) {
    setMessage(`${groupLabel}：全部分類（共 ${count} 組），按「儲存」生效。`, true);
  } else {
    const catLabels = config.cats.filter(c => cats.has(c.id)).map(c => c.label).join("、");
    setMessage(`${groupLabel}：${catLabels}（共 ${count} 組），按「儲存」生效。`, true);
  }
}

/** 更新指定群組分類按鈕的發光狀態 */
function updateGroupCatBarUI(groupIdx) {
  if (!groupCatBarsContainer) return;
  const bar = groupCatBarsContainer.querySelector(`[data-group-cat="${groupIdx}"]`);
  if (!bar) return;
  const cats = activeGroupCats[groupIdx];

  bar.querySelectorAll(".gcat-btn").forEach(btn => {
    const catId = btn.dataset.cat;
    let isActive;
    if (catId === "ALL") {
      isActive = cats === null || cats === undefined;
    } else {
      isActive = (cats === null || cats === undefined) || cats.has(catId);
    }
    if (isActive) {
      btn.style.background = "#42a5f5";
      btn.style.color = "#fff";
      btn.style.borderColor = "#1976d2";
      btn.style.boxShadow = "0 0 8px 2px rgba(66,165,245,0.4)";
    } else {
      btn.style.background = "#2a2a2a";
      btn.style.color = "#666";
      btn.style.borderColor = "#444";
      btn.style.boxShadow = "none";
    }
  });
}

/** 重建指定群組在 displayRows 中的項目（分類篩選變動時呼叫） */
function rebuildGroupDisplay(groupIdx) {
  const sourceKey = "group-" + groupIdx;
  if (!activeGroups.has(groupIdx)) return;
  // 移除舊的項目
  displayRows = displayRows.filter(r => r.source !== sourceKey);
  // 重新載入（套用分類篩選）
  const removed = loadGroupRemoved();
  const removedSet = new Set(
    (removed[groupIdx] || []).map(s => s.split(",").map(p => p.trim().toLowerCase()).filter(Boolean).join(","))
  );
  const config = GROUP_CATEGORIES_CONFIG[groupIdx];
  const cats = activeGroupCats[groupIdx];
  for (const w of GROUP_ALL[groupIdx]) {
    const norm = w.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
    if (removedSet.has(norm)) continue;
    if (config && cats !== null && cats !== undefined) {
      const cat = config.getCategory(w);
      if (cat && !cats.has(cat)) continue;
    }
    displayRows.push({ text: w, source: sourceKey });
  }
  updateTotalCount();
}

/** 根據各群組是否啟用來顯示/隱藏對應的分類按鈕列 */
function updateGroupCatBarsVisibility() {
  if (!groupCatBarsContainer) return;
  for (const gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    const groupIdx = parseInt(gi);
    const show = activeGroups.has(groupIdx) && !singleWordMode;
    let bar = groupCatBarsContainer.querySelector(`[data-group-cat="${groupIdx}"]`);
    if (show) {
      if (!bar) renderGroupCatBar(groupIdx);
      bar = groupCatBarsContainer.querySelector(`[data-group-cat="${groupIdx}"]`);
      if (bar) bar.style.display = "flex";
    } else {
      if (bar) bar.style.display = "none";
    }
  }
}

// ── 字母子群組 UI ──

/** 渲染字母篩選按鈕列 */
function renderLetterBar() {
  if (!letterSubgroupBar) return;
  letterSubgroupBar.innerHTML = "";

  // 「全選」按鈕
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "全部";
  allBtn.className = "letter-btn";
  allBtn.dataset.letter = "ALL";
  allBtn.style.cssText = "padding:7px 10px;font-size:0.82rem;font-weight:700;" +
    "border:2px solid #666;border-radius:8px;background:#2a2a2a;color:#ccc;" +
    "cursor:pointer;transition:background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s;min-width:48px;";
  letterSubgroupBar.appendChild(allBtn);

  for (const letter of _lettersSorted) {
    const count = _letterMap[letter].length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = letter + "\u2009" + count;
    btn.className = "letter-btn";
    btn.dataset.letter = letter;
    btn.style.cssText = "padding:7px 6px;font-size:0.78rem;font-weight:600;" +
      "border:2px solid #666;border-radius:8px;background:#2a2a2a;color:#ccc;" +
      "cursor:pointer;transition:background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s;min-width:40px;";
    letterSubgroupBar.appendChild(btn);
  }

  // 綁定事件
  letterSubgroupBar.querySelectorAll(".letter-btn").forEach(btn => {
    tapBind(btn, () => toggleLetter(btn.dataset.letter));
  });

  updateLetterBarUI();
}

/** 切換字母選取 */
function toggleLetter(letter) {
  if (letter === "ALL") {
    if (activeLetters === null) {
      activeLetters = new Set(); // 全部取消
    } else {
      activeLetters = null; // 全選
    }
  } else {
    if (activeLetters === null) {
      // 原本全選 → 取消這個字母（= 選其他所有字母）
      activeLetters = new Set(_lettersSorted);
      activeLetters.delete(letter);
    } else if (activeLetters.has(letter)) {
      activeLetters.delete(letter);
      // 不允許一個都不選 → 自動變回全選
      if (activeLetters.size === 0) {
        activeLetters = null;
      }
    } else {
      activeLetters.add(letter);
      // 如果全部選了 → 用 null 表示全選
      if (activeLetters.size >= _lettersSorted.length) {
        activeLetters = null;
      }
    }
  }

  // 重建 displayRows
  rebuildSingleWordDisplay();
  updateLetterBarUI();
  renderRows();

  const count = displayRows.filter(r => r.source === "custom").length;
  if (activeLetters === null) {
    setMessage(`已選取全部字母（共 ${count} 組），按「儲存」生效。`, true);
  } else {
    const letters = [...activeLetters].sort().join(", ");
    setMessage(`已篩選 ${letters}（共 ${count} 組），按「儲存」生效。`, true);
  }
}

/** 更新字母按鈕的發光狀態 */
function updateLetterBarUI() {
  if (!letterSubgroupBar) return;
  letterSubgroupBar.querySelectorAll(".letter-btn").forEach(btn => {
    const letter = btn.dataset.letter;
    let isActive;
    if (letter === "ALL") {
      isActive = activeLetters === null;
    } else {
      isActive = activeLetters === null || activeLetters.has(letter);
    }
    if (isActive) {
      btn.style.background = "#4caf50";
      btn.style.color = "#fff";
      btn.style.borderColor = "#388e3c";
      btn.style.boxShadow = "0 0 8px 2px rgba(76,175,80,0.4)";
    } else {
      btn.style.background = "#2a2a2a";
      btn.style.color = "#666";
      btn.style.borderColor = "#444";
      btn.style.boxShadow = "none";
    }
  });
}

/** 重建單字模式的 displayRows（字母篩選變動時呼叫） */
function rebuildSingleWordDisplay() {
  if (!singleWordMode) return;
  displayRows = [];
  for (const w of customRowsFull) {
    const parts = w.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length !== 2) continue;
    if (activeLetters !== null) {
      const letter = getGermanFirstLetter(w);
      if (!letter || !activeLetters.has(letter)) continue;
    }
    displayRows.push({ text: w, source: "custom" });
  }
  updateTotalCount();
}

/** 單字模式：一鍵套用「自定義 + 只顯示2欄項目 + 德文拆字」 */
function toggleSingleWordMode() {
  // 切換前：先把手動移除同步回 customRowsFull
  syncCustomFullFromDisplay();

  singleWordMode = !singleWordMode;
  if (singleWordMode) {
    sentenceMode = false;
  }

  // 不管開啟或關閉，組合長度固定 2格、來源固定自定義
  len2Toggle.checked = true;
  len3Toggle.checked = false;
  len4Toggle.checked = false;
  len5Toggle.checked = false;
  activeGroups = new Set();
  customActive = true;

  // 重建 displayRows：從已同步的 customRowsFull 載入
  displayRows = [];
  for (const w of customRowsFull) {
    if (singleWordMode) {
      // 單字模式：只保留 2 欄項目（中文提示 + 德文單字）
      const parts = w.split(",").map(s => s.trim()).filter(Boolean);
      if (parts.length !== 2) continue;
      // 字母篩選
      if (activeLetters !== null) {
        const letter = getGermanFirstLetter(w);
        if (!letter || !activeLetters.has(letter)) continue;
      }
    }
    displayRows.push({ text: w, source: "custom" });
  }

  // 渲染字母篩選按鈕（開啟時建立，關閉時隱藏）
  if (singleWordMode) {
    renderLetterBar();
  }

  updateSourceUI();
  renderRows();
  if (singleWordMode) {
    const count = displayRows.filter(r => r.source === "custom").length;
    const letterInfo = activeLetters === null ? "全部字母" : [...activeLetters].sort().join(", ");
    setMessage(`✅ 單字模式已開啟：找到 ${count} 組「中文＋德文單字」（${letterInfo}），德文將自動拆成字母方塊。按「儲存」生效。`, true);
  } else {
    const count = displayRows.length;
    setMessage(`🔤 單字模式已關閉，保留自定義（${count} 組）+ 2格設定。`, true);
  }
}

function renderSentenceCatBar() {
  if (!sentenceCatBar) return;
  sentenceCatBar.innerHTML = "";
  // 「全選」按鈕
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.textContent = "全部";
  allBtn.className = "sent-cat-btn";
  allBtn.dataset.cat = "ALL";
  Object.assign(allBtn.style, {
    padding: "6px 10px", fontSize: "0.78rem", fontWeight: "600",
    border: "2px solid #444", borderRadius: "8px",
    background: "#2a2a2a", color: "#ccc", cursor: "pointer",
    transition: "background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s"
  });
  allBtn.addEventListener("click", () => toggleSentenceCat("ALL"));
  sentenceCatBar.appendChild(allBtn);

  for (const cat of SENTENCE_CATEGORIES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = cat.label;
    btn.className = "sent-cat-btn";
    btn.dataset.cat = cat.id;
    const count = cat.end - cat.start + 1;
    btn.title = `${cat.label}（${count} 句）`;
    Object.assign(btn.style, {
      padding: "6px 10px", fontSize: "0.78rem", fontWeight: "600",
      border: "2px solid #444", borderRadius: "8px",
      background: "#2a2a2a", color: "#ccc", cursor: "pointer",
      transition: "background 0.15s,box-shadow 0.2s,color 0.15s,border-color 0.15s"
    });
    btn.addEventListener("click", () => toggleSentenceCat(cat.id));
    sentenceCatBar.appendChild(btn);
  }
  updateSentenceCatBarUI();
}

function toggleSentenceCat(catId) {
  const allIds = SENTENCE_CATEGORIES.map(c => c.id);

  if (catId === "ALL") {
    if (activeSentenceCats === null) {
      activeSentenceCats = new Set();
    } else {
      activeSentenceCats = null;
    }
  } else {
    if (activeSentenceCats === null) {
      activeSentenceCats = new Set(allIds);
      activeSentenceCats.delete(catId);
    } else if (activeSentenceCats.has(catId)) {
      activeSentenceCats.delete(catId);
      if (activeSentenceCats.size === 0) {
        activeSentenceCats = null;
      }
    } else {
      activeSentenceCats.add(catId);
      if (activeSentenceCats.size >= allIds.length) {
        activeSentenceCats = null;
      }
    }
  }

  updateSentenceCatBarUI();
  updateTotalCount();
  const filtered = getFilteredSentenceRows(activeSentenceCats);
  if (activeSentenceCats === null) {
    setMessage(`📝 已選取全部分類（共 ${filtered.length} 句），按「儲存」生效。`, true);
  } else if (activeSentenceCats.size === 0) {
    setMessage(`📝 未選取任何分類（0 句）`, true);
  } else {
    const label = [...activeSentenceCats].map(id => {
      const c = SENTENCE_CATEGORIES.find(x => x.id === id);
      return c ? c.label : id;
    }).join("、");
    setMessage(`📝 已篩選 ${label}（共 ${filtered.length} 句），按「儲存」生效。`, true);
  }
}

function updateSentenceCatBarUI() {
  if (!sentenceCatBar) return;
  sentenceCatBar.querySelectorAll(".sent-cat-btn").forEach(btn => {
    const catId = btn.dataset.cat;
    let isActive;
    if (catId === "ALL") {
      isActive = activeSentenceCats === null;
    } else {
      isActive = activeSentenceCats === null || activeSentenceCats.has(catId);
    }
    if (isActive) {
      btn.style.background = "#e91e63";
      btn.style.color = "#fff";
      btn.style.borderColor = "#c2185b";
      btn.style.boxShadow = "0 0 8px 2px rgba(233,30,99,0.4)";
    } else {
      btn.style.background = "#2a2a2a";
      btn.style.color = "#666";
      btn.style.borderColor = "#444";
      btn.style.boxShadow = "none";
    }
  });
}

function toggleSentenceMode() {
  sentenceMode = !sentenceMode;
  if (sentenceMode) {
    singleWordMode = false;
    renderSentenceCatBar();
  }
  updateSourceUI();
  updateTotalCount();
  if (sentenceMode) {
    const filtered = getFilteredSentenceRows(activeSentenceCats);
    setMessage(`✅ 句子模式已開啟：共 ${filtered.length} 個句子。按「儲存」生效。`, true);
  } else {
    setMessage(`📝 句子模式已關閉。`, true);
  }
}

function updateSourceUI() {
  // 群組按鈕發光狀態
  groupBtns.forEach(btn => {
    const gi = parseInt(btn.dataset.group, 10);
    btn.classList.toggle("active", activeGroups.has(gi));
  });
  // 自定義按鈕發光狀態
  customSourceBtn.classList.toggle("active", customActive);

  // ── 句子模式按鈕外觀 ──
  const sentenceModeBtn = document.getElementById("sentenceModeBtn");
  if (sentenceModeBtn) {
    if (sentenceMode) {
      sentenceModeBtn.style.background = "#e91e63";
      sentenceModeBtn.style.color = "#fff";
      sentenceModeBtn.style.borderColor = "#c2185b";
      sentenceModeBtn.style.boxShadow = "0 0 12px 3px rgba(233,30,99,0.55)";
      sentenceModeBtn.textContent = "📝 句子模式 ON";
    } else {
      sentenceModeBtn.style.background = "#2a2a2a";
      sentenceModeBtn.style.color = "#ccc";
      sentenceModeBtn.style.borderColor = "#666";
      sentenceModeBtn.style.boxShadow = "none";
      sentenceModeBtn.textContent = "📝 句子模式";
    }
  }

  // ── 句子分類篩選列 ──
  if (sentenceCatBar) {
    if (sentenceMode) {
      if (sentenceCatBar.children.length === 0) renderSentenceCatBar();
      sentenceCatBar.style.display = "flex";
      updateSentenceCatBarUI();
    } else {
      sentenceCatBar.style.display = "none";
    }
  }

  // ── 單字模式按鈕外觀 ──
  if (singleWordMode) {
    singleWordModeBtn.style.background = "#ff9800";
    singleWordModeBtn.style.color = "#000";
    singleWordModeBtn.style.borderColor = "#e6a800";
    singleWordModeBtn.style.boxShadow = "0 0 12px 3px rgba(255,152,0,0.55), inset 0 0 6px rgba(255,152,0,0.15)";
    singleWordModeBtn.textContent = "🔤 單字模式 ON";
  } else {
    singleWordModeBtn.style.background = "#2a2a2a";
    singleWordModeBtn.style.color = "#ccc";
    singleWordModeBtn.style.borderColor = "#666";
    singleWordModeBtn.style.boxShadow = "none";
    singleWordModeBtn.textContent = "🔤 單字模式";
  }
  // 提示文字
  if (singleWordModeHint) singleWordModeHint.style.display = singleWordMode ? "" : "none";

  // ── 字母篩選列 ──
  if (letterSubgroupBar) {
    letterSubgroupBar.style.display = singleWordMode ? "flex" : "none";
    if (singleWordMode) updateLetterBarUI();
  }

  // ── 群組分類篩選列（群組 2/3/4/5） ──
  updateGroupCatBarsVisibility();

  // ── 單字模式 → 反灰「允許的組合長度」和「單字來源」 ──
  if (lenSection) {
    lenSection.style.opacity = singleWordMode ? "0.35" : "";
    lenSection.style.pointerEvents = singleWordMode ? "none" : "";
  }
  if (sourceSection) {
    sourceSection.style.opacity = singleWordMode ? "0.35" : "";
    sourceSection.style.pointerEvents = singleWordMode ? "none" : "";
  }

  // ── 拆分模式按鈕 ──
  if (splitModeBar) {
    if (singleWordMode) {
      splitModeBar.style.opacity = "";
      splitModeBar.style.pointerEvents = "";
    } else {
      splitModeBar.style.opacity = "0.35";
      splitModeBar.style.pointerEvents = "none";
    }
    splitModeBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.split === splitMode);
    });
  }

  // 自定義輸入區域顯示/隱藏（自定義 或 單字模式 開啟時都顯示）
  customInputArea.style.display = (customActive || singleWordMode) ? "" : "none";
}

// ── 新增自定義 word ──
function addRow() {
  const input = newRowInput.value.trim();
  if (!input) {
    setMessage("請先輸入資料列。");
    return;
  }
  const normalized = normalizeRowString(input);
  if (!isValidRowString(normalized)) {
    setMessage("格式錯誤：每列需要 2~5 欄，使用逗號分隔。");
    return;
  }
  customRows.push(normalized);
  customRowsFull.push(normalized);  // 同步到完整快照
  saveCustomRowsFull();             // 持久化完整快照
  if (customActive) {
    displayRows.push({ text: normalized, source: "custom" });
  }
  newRowInput.value = "";
  renderRows();
  setMessage("已新增一列，按「儲存」生效。", true);
}

// ── 儲存 ──
function saveRows() {
  // 單字模式：強制自定義啟用，跳過來源/長度檢查
  if (singleWordMode) {
    customActive = true;
  }

  // 至少要有一個來源啟用
  if (!singleWordMode && !sentenceMode && activeGroups.size === 0 && !customActive) {
    setMessage("請至少啟用一個單字來源。");
    return;
  }
  // 如果有啟用但列表為空（句子模式不依賴 displayRows，跳過此檢查）
  if (!sentenceMode && displayRows.length === 0) {
    setMessage("單字列表不能為空，請新增至少 1 列。");
    return;
  }

  // 讀取並驗證抽取組數
  pickCount = parseInt(pickCountInput.value, 10) || 0;
  if (pickCount < 0) pickCount = 0;
  if (sentenceMode) {
    const filteredSentenceCount = getFilteredSentenceRows(activeSentenceCats).length;
    if (pickCount > filteredSentenceCount) pickCount = filteredSentenceCount;
  } else {
    if (pickCount > displayRows.length) pickCount = displayRows.length;
  }
  pickCountInput.value = pickCount;

  // 收集允許的組合長度（單字模式下長度由拆字決定，這裡仍然儲存以便切回時使用）
  const allowedLens = [];
  if (len2Toggle.checked) allowedLens.push(2);
  if (len3Toggle.checked) allowedLens.push(3);
  if (len4Toggle.checked) allowedLens.push(4);
  if (len5Toggle.checked) allowedLens.push(5);
  if (!singleWordMode && !sentenceMode && allowedLens.length === 0) {
    setMessage("至少要勾選一種組合長度。");
    return;
  }
  // 單字模式下若沒勾選任何長度，預設全勾
  if (allowedLens.length === 0) {
    allowedLens.push(2, 3, 4, 5);
  }

  // 從 displayRows 提取目前的自定義 word（可能已被移除部分）
  if (customActive) {
    if (singleWordMode) {
      // 單字模式：儲存字母篩選後的結果（displayRows 已經過字母篩選）
      customRows = displayRows.filter(r => r.source === "custom").map(r => r.text);
    } else {
      customRows = displayRows.filter(r => r.source === "custom").map(r => r.text);
    }
  }

  // 計算使用者在設定頁手動移除的群組 word，寫入 GROUP_REMOVED_KEY
  const manualRemoved = {};
  for (const gi of activeGroups) {
    const key = "group-" + gi;
    // displayRows 中屬於該群組的 word（正規化後）
    const currentSet = new Set(
      displayRows
        .filter(r => r.source === key)
        .map(r => r.text.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(","))
    );
    // 原始群組中有，但 displayRows 中沒有的 → 被手動移除
    const removedWords = GROUP_ALL[gi].filter(w => {
      const norm = w.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
      return !currentSet.has(norm);
    });
    if (removedWords.length > 0) {
      manualRemoved[gi] = removedWords;
    }
  }

  // 儲存
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customRows));
  localStorage.setItem(PICK_KEY, String(pickCount));
  localStorage.setItem(DEBUG_KEY, debugToggle.checked ? "1" : "0");
  localStorage.setItem(LENS_KEY, JSON.stringify(allowedLens));
  localStorage.setItem(AUTO_REMOVE_KEY, autoRemoveToggle.checked ? "1" : "0");
  localStorage.setItem(BATTLE_MODE_KEY, battleModeToggle.checked ? "1" : "0");
  localStorage.setItem(GROUPS_KEY, JSON.stringify([...activeGroups]));
  localStorage.setItem(CUSTOM_ACTIVE_KEY, customActive ? "1" : "0");
  localStorage.setItem(SINGLE_WORD_MODE_KEY, singleWordMode ? "1" : "0");
  localStorage.setItem(SENTENCE_MODE_KEY, sentenceMode ? "1" : "0");
  if (sentenceMode) {
    const filteredSentences = getFilteredSentenceRows(activeSentenceCats);
    localStorage.setItem(SENTENCE_DATA_KEY, JSON.stringify(filteredSentences));
  }
  if (activeSentenceCats === null) {
    localStorage.removeItem(SENTENCE_CATS_KEY);
  } else {
    localStorage.setItem(SENTENCE_CATS_KEY, JSON.stringify([...activeSentenceCats]));
  }
  localStorage.setItem(SPLIT_MODE_KEY, splitMode);
  // 儲存群組資料（套用各群組分類篩選後存入）
  const groupDataToSave = GROUP_ALL.map((group, idx) => {
    const catConfig = GROUP_CATEGORIES_CONFIG[idx];
    const cats = activeGroupCats[idx];
    if (catConfig && cats !== null && cats !== undefined) {
      return group.filter(w => {
        const cat = catConfig.getCategory(w);
        return !cat || cats.has(cat);
      });
    }
    return group;
  });
  localStorage.setItem(GROUP_DATA_KEY, JSON.stringify(groupDataToSave));
  // 儲存字母篩選
  if (activeLetters === null) {
    localStorage.removeItem(WORD_LETTERS_KEY);
  } else {
    localStorage.setItem(WORD_LETTERS_KEY, JSON.stringify([...activeLetters]));
  }
  // 儲存各群組分類篩選
  for (const _gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    const gi = parseInt(_gi);
    const cfg = GROUP_CATEGORIES_CONFIG[gi];
    const cats = activeGroupCats[gi];
    if (cats === null || cats === undefined) {
      localStorage.removeItem(cfg.storageKey);
    } else {
      localStorage.setItem(cfg.storageKey, JSON.stringify([...cats]));
    }
  }
  // 若有手動移除的群組 word，儲存到 GROUP_REMOVED_KEY；否則清除
  if (Object.keys(manualRemoved).length > 0) {
    localStorage.setItem(GROUP_REMOVED_KEY, JSON.stringify(manualRemoved));
  } else {
    localStorage.removeItem(GROUP_REMOVED_KEY);
  }

  // 提示訊息
  const parts = [];
  if (activeGroups.size > 0) {
    const names = [...activeGroups].sort().map(i => GROUP_NAMES[i] || `群組${i + 1}`).join("＋");
    const totalWords = displayRows.filter(r => r.source.startsWith("group-")).length;
    parts.push(`${names}（${totalWords} 組）`);
  }
  if (sentenceMode) {
    const savedSentenceCount = getFilteredSentenceRows(activeSentenceCats).length;
    const catLabel = activeSentenceCats === null ? "全部分類" : [...activeSentenceCats].map(id => {
      const c = SENTENCE_CATEGORIES.find(x => x.id === id);
      return c ? c.label : id;
    }).join("、");
    parts.push(`句子模式（${catLabel}，${savedSentenceCount} 句）`);
  }
  if (customActive) {
    const customCount = displayRows.filter(r => r.source === "custom").length;
    if (singleWordMode) {
      const splitLabel = splitMode === "syllable" ? "音節拆分" :
                         splitMode === "random" ? "隨機拆分" :
                         splitMode === "letter" ? "逐字母拆分" : "混合拆分";
      const letterLabel = activeLetters === null ? "全部字母" :
                          [...activeLetters].sort().join("");
      parts.push(`單字模式（${letterLabel}，${customCount} 組，${splitLabel}）`);
    } else {
      parts.push(`自定義（${customCount} 組）`);
    }
  }
  const modeText = parts.join("＋");
  const lenText = allowedLens.length === 4
    ? "全部長度"
    : allowedLens.map(n => n + "格").join("、");
  setMessage(`已儲存（${modeText}，${lenText}），回遊戲頁重新開始即可套用。`, true);
}

// ── 還原預設（B1 單字群組 + 每局抽 20 組） ──
function resetDefault() {
  // 1) 重置所有記憶體狀態
  customRows = [...DEFAULT_WORD_ROWS];
  customRowsFull = [...DEFAULT_WORD_ROWS];
  activeGroups = new Set([0]);
  customActive = false;
  singleWordMode = false;
  sentenceMode = false;
  activeSentenceCats = null;
  splitMode = "syllable";
  activeLetters = null;
  // 重置所有群組分類篩選
  for (const _gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    activeGroupCats[parseInt(_gi)] = null;
  }
  pickCount = 20;
  pickCountInput.value = 20;
  autoRemoveToggle.checked = false;
  battleModeToggle.checked = false;
  len2Toggle.checked = true;
  len3Toggle.checked = true;
  len4Toggle.checked = true;
  len5Toggle.checked = true;

  // 2) 清除「立即載入」暫存
  if (typeof _loadedFailedWords !== "undefined") _loadedFailedWords = [];
  if (failedWordsArea) failedWordsArea.style.display = "none";

  // 3) 重建顯示列表 & 更新 UI
  buildDisplayRows();
  updateSourceUI();
  renderRows();

  // 4) 直接寫入 localStorage（等同自動儲存，不需再按「儲存」）
  saveCustomRowsFull();                                         // 完整快照
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customRows));
  localStorage.setItem(PICK_KEY, String(20));
  localStorage.setItem(DEBUG_KEY, debugToggle.checked ? "1" : "0");
  localStorage.setItem(LENS_KEY, JSON.stringify([2, 3, 4, 5]));
  localStorage.setItem(AUTO_REMOVE_KEY, "0");
  localStorage.setItem(BATTLE_MODE_KEY, "0");
  localStorage.setItem(GROUPS_KEY, JSON.stringify([0]));
  localStorage.setItem(CUSTOM_ACTIVE_KEY, "0");
  localStorage.setItem(SINGLE_WORD_MODE_KEY, "0");
  localStorage.setItem(SENTENCE_MODE_KEY, "0");
  localStorage.removeItem(SENTENCE_DATA_KEY);
  localStorage.removeItem(SENTENCE_CATS_KEY);
  localStorage.setItem(SPLIT_MODE_KEY, "syllable");
  localStorage.setItem(GROUP_DATA_KEY, JSON.stringify(GROUP_ALL));
  localStorage.removeItem(GROUP_REMOVED_KEY);                   // 清除手動移除紀錄
  localStorage.removeItem(WORD_LETTERS_KEY);                    // 清除字母篩選
  // 清除所有群組分類篩選
  for (const _gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    localStorage.removeItem(GROUP_CATEGORIES_CONFIG[parseInt(_gi)].storageKey);
  }

  setMessage("✅ 已還原預設並自動儲存，回遊戲頁即可套用。", true);
}

// ── 學習統計（Google Sheets 同步 + Google 登入） ──

const GOOGLE_CLIENT_ID = "280426045341-s5tias2et5fgfkm6v4pasodaimi9usot.apps.googleusercontent.com";     // Google Cloud Console 的 OAuth Client ID

const viewStatsBtn = document.getElementById("viewStatsBtn");
const clearStatsBtn = document.getElementById("clearStatsBtn");
const statsDisplay = document.getElementById("statsDisplay");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const googleUserInfo = document.getElementById("googleUserInfo");
const googleUserAvatar = document.getElementById("googleUserAvatar");
const googleUserName = document.getElementById("googleUserName");
const googleSignOutBtn = document.getElementById("googleSignOutBtn");

// ── Google 登入 ──

/** 解碼 JWT credential（不需要外部 library） */
function decodeJwt(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(jsonPayload);
}

function loadGoogleUser() {
  try {
    const raw = localStorage.getItem(GOOGLE_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveGoogleUser(user) {
  localStorage.setItem(GOOGLE_USER_KEY, JSON.stringify(user));
}

function clearGoogleUser() {
  localStorage.removeItem(GOOGLE_USER_KEY);
}

/** 登入成功回呼 */
function handleGoogleCredentialResponse(response) {
  try {
    const payload = decodeJwt(response.credential);
    const user = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || "",
    };
    saveGoogleUser(user);
    updateGoogleAuthUI();
    setMessage("✅ 已登入：" + user.email, true);
  } catch (e) {
    setMessage("❌ Google 登入失敗：" + e.message);
  }
}

/** 更新登入 / 登出 UI */
function updateGoogleAuthUI() {
  const user = loadGoogleUser();
  if (user) {
    googleSignInBtn.style.display = "none";
    googleUserInfo.style.display = "flex";
    googleUserName.textContent = user.name + " (" + user.email + ")";
    if (user.picture) {
      googleUserAvatar.src = user.picture;
      googleUserAvatar.style.display = "inline";
    } else {
      googleUserAvatar.style.display = "none";
    }
  } else {
    googleSignInBtn.style.display = "block";
    googleUserInfo.style.display = "none";
  }
}

/** 初始化 GIS（等 library 載入完成後呼叫） */
let _gisRetry = 0;
function initGoogleSignIn() {
  if (typeof google === "undefined" || !google.accounts) {
    _gisRetry++;
    if (_gisRetry > 15) {
      // 5 秒後放棄（可能是 file:// 或無網路）
      console.warn("Google Identity Services 載入失敗，Google 登入功能不可用。請確認使用 http:// 或 https:// 開啟頁面。");
      googleSignInBtn.innerHTML = '<p style="color:#888;font-size:12px;">⚠️ Google 登入不可用（需透過 http/https 開啟頁面）</p>';
      updateGoogleAuthUI();
      return;
    }
    setTimeout(initGoogleSignIn, 300);
    return;
  }
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
    });
    // 僅在未登入時渲染按鈕
    if (!loadGoogleUser()) {
      google.accounts.id.renderButton(googleSignInBtn, {
        theme: "outline",
        size: "medium",
        text: "signin_with",
        locale: "zh-TW",
      });
    }
  } catch (e) {
    console.warn("Google Sign-In 初始化失敗:", e);
    googleSignInBtn.innerHTML = '<p style="color:#888;font-size:12px;">⚠️ Google 登入初始化失敗</p>';
  }
  updateGoogleAuthUI();
}

tapBind(googleSignOutBtn, () => {
  clearGoogleUser();
  // 清除 GIS 狀態
  if (typeof google !== "undefined" && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
  updateGoogleAuthUI();
  // 重新渲染登入按鈕
  if (typeof google !== "undefined" && google.accounts) {
    google.accounts.id.renderButton(googleSignInBtn, {
      theme: "outline",
      size: "medium",
      text: "signin_with",
      locale: "zh-TW",
    });
  }
  setMessage("已登出 Google 帳號。");
});

// 頁面載入後初始化 GIS
initGoogleSignIn();

// ── 統計功能（從 Google Sheets 讀取） ──

const loadFailedBtn = document.getElementById("loadFailedBtn");
const failedWordsArea = document.getElementById("failedWordsArea");

/**
 * 從 Google Sheets 取得統計資料
 * 策略：http/https 頁面先嘗試 fetch；失敗或 file:// 頁面改用 JSONP
 */
function fetchStatsFromSheets(action) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("YOUR_")) {
    return Promise.reject(new Error("請先在 shared.js 中設定 APPS_SCRIPT_URL。"));
  }
  const user = loadGoogleUser();
  if (!user) {
    return Promise.reject(new Error("請先登入 Google 帳號。"));
  }

  const baseUrl = APPS_SCRIPT_URL
    + "?action=" + encodeURIComponent(action)
    + "&email=" + encodeURIComponent(user.email);

  // http / https → 嘗試 fetch，失敗再回退 JSONP
  if (location.protocol === "http:" || location.protocol === "https:") {
    return _fetchViaFetch(baseUrl).catch(fetchErr => {
      console.warn("fetch 方式失敗，改用 JSONP:", fetchErr.message);
      return _fetchViaJsonp(baseUrl);
    });
  }
  // file:// → 直接用 JSONP
  return _fetchViaJsonp(baseUrl);
}

/** 方式一：使用 fetch（適用 http/https 頁面） */
function _fetchViaFetch(baseUrl) {
  return fetch(baseUrl, { redirect: "follow" })
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(data => {
      if (data && data.ok) return data;
      throw new Error(data.error || "回傳資料異常");
    });
}

/** 方式二：JSONP（適用 file:// 頁面，也可作備用） */
function _fetchViaJsonp(baseUrl) {
  return new Promise((resolve, reject) => {
    const cbName = "_jsonpCb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(
        "請求逾時（20 秒）。\n\n" +
        "🔧 請確認以下事項：\n" +
        "1. google_apps_script.js 已完整貼入 Apps Script 編輯器\n" +
        "2. 已點選「部署 → 管理部署 → ✏️ → 版本選「新版本」→ 部署」\n" +
        "3. 存取權限設為「所有人」\n\n" +
        "📋 測試網址（在瀏覽器新分頁開啟看是否回傳 JSON）：\n" + baseUrl
      ));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      const el = document.getElementById(cbName);
      if (el) el.remove();
    }

    window[cbName] = function (data) {
      cleanup();
      if (data && data.ok) {
        resolve(data);
      } else {
        reject(new Error(data ? (data.error || "回傳資料異常") : "回傳為空"));
      }
    };

    const url = baseUrl + "&callback=" + encodeURIComponent(cbName);
    const script = document.createElement("script");
    script.id = cbName;
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error(
        "Script 載入失敗。\n\n" +
        "🔧 最可能的原因：\n" +
        "① Apps Script 尚未重新部署（需要「管理部署 → 新版本 → 部署」）\n" +
        "② 部署網址已變更（重新部署後請更新 APPS_SCRIPT_URL）\n\n" +
        "📋 請在瀏覽器新分頁開啟以下網址測試：\n" + baseUrl
      ));
    };
    document.head.appendChild(script);
  });
}

// ── 查看失敗率排行（從 Google Sheets） ──

let statsFilterAbove50 = false;
let _cachedSheetStats = null; // 暫存，避免重複 fetch

tapBind(viewStatsBtn, async () => {
  statsFilterAbove50 = false;
  _cachedSheetStats = null;
  statsDisplay.style.display = "block";
  statsDisplay.innerHTML = '<p style="color:#666;">⏳ 正在從 Google Sheets 載入統計資料...</p>';
  try {
    const data = await fetchStatsFromSheets("stats");
    if (!data.ok) throw new Error(data.error || "未知錯誤");
    _cachedSheetStats = data.stats || [];
    renderStatsDisplay();
  } catch (e) {
    const msg = e.message || "未知錯誤";
    // 將 \n 轉為 <br>，讓診斷資訊換行顯示
    const htmlMsg = escapeHtml(msg).replace(/\n/g, "<br>");
    statsDisplay.innerHTML = `<p style="color:#c62828;white-space:pre-wrap;">❌ ${htmlMsg}</p>`;
  }
});

function renderStatsDisplay() {
  const sorted = _cachedSheetStats || [];
  if (sorted.length === 0) {
    statsDisplay.style.display = "block";
    statsDisplay.innerHTML = "<p style='color:#666;'>Google Sheets 中尚無統計資料。玩幾局遊戲後資料會自動同步。</p>";
    return;
  }

  const above50 = sorted.filter(s => s.failRate > 0.5);
  const above70 = sorted.filter(s => s.failRate > 0.7);
  const list = statsFilterAbove50 ? above50 : sorted;

  let html = `<div style="margin-bottom:10px;padding:10px 14px;background:#f0f4ff;border-radius:8px;font-size:13px;border:1px solid #d0d8f0;">`;
  html += `<div style="font-weight:bold;color:#333;margin-bottom:4px;">📊 統計摘要（共 ${sorted.length} 組）</div>`;
  html += `<span style="color:#c62828;">🔴 失敗率 &gt; 70%：<b>${above70.length}</b> 組</span>`;
  html += `<span style="margin-left:12px;color:#e65100;">🟠 失敗率 &gt; 50%：<b>${above50.length}</b> 組</span>`;
  html += `<br><span style="color:#666;font-size:12px;margin-top:4px;display:inline-block;">💡 資料來源：Google Sheets（重新開始 / 遊戲結束 / 破關 時自動同步）</span>`;
  html += `</div>`;

  const btnStyle50 = statsFilterAbove50
    ? "background:#e65100;color:#fff;border:none;"
    : "background:#fff;color:#e65100;border:1px solid #e65100;";
  const btnStyleAll = !statsFilterAbove50
    ? "background:#1565c0;color:#fff;border:none;"
    : "background:#fff;color:#1565c0;border:1px solid #1565c0;";
  html += `<div style="margin-bottom:10px;display:flex;gap:8px;">`;
  html += `<button id="_statsShowAll" style="${btnStyleAll}padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">全部 (${sorted.length})</button>`;
  html += `<button id="_statsShow50" style="${btnStyle50}padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">失敗率 &gt; 50% (${above50.length})</button>`;
  html += `</div>`;

  if (list.length === 0) {
    html += `<p style="color:#2e7d32;font-weight:bold;">🎉 太棒了！沒有失敗率超過 50% 的組合。</p>`;
  } else {
    html += `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#e8eaf6;border-bottom:2px solid #c5cae9;text-align:left;">
          <th style="padding:6px 8px;color:#333;">#</th>
          <th style="padding:6px 8px;color:#333;">組合</th>
          <th style="padding:6px 8px;color:#333;text-align:center;">出現</th>
          <th style="padding:6px 8px;color:#333;text-align:center;">消除</th>
          <th style="padding:6px 8px;color:#333;">失敗率</th>
        </tr>
      </thead><tbody>`;

    const showCount = Math.min(list.length, 50);
    for (let i = 0; i < showCount; i++) {
      const s = list[i];
      const failPct = (s.failRate * 100).toFixed(0);
      const barColor = s.failRate > 0.7 ? "#c62828" : s.failRate > 0.5 ? "#e65100" : s.failRate > 0.3 ? "#f9a825" : "#2e7d32";
      const rowBg = s.failRate > 0.7 ? "background:#ffebee;" : s.failRate > 0.5 ? "background:#fff3e0;" : "";
      const parts = (s.display || s.comboKey || "").split(",");
      let comboHtml;
      if (parts.length >= 2) {
        const hint = escapeHtml(parts[0]);
        const words = parts.slice(1).map(w => escapeHtml(w.trim())).join(", ");
        comboHtml = `<span style="color:#1565c0;font-weight:600;">${words}</span>` +
                    `<br><span style="color:#888;font-size:11px;">${hint}</span>`;
      } else {
        comboHtml = `<span style="color:#333;font-weight:500;">${escapeHtml(s.display || s.comboKey || "")}</span>`;
      }
      html += `<tr style="border-bottom:1px solid #eee;${rowBg}">
        <td style="padding:6px 8px;color:#999;font-size:12px;">${i + 1}</td>
        <td style="padding:6px 8px;word-break:break-all;">${comboHtml}</td>
        <td style="padding:6px 8px;text-align:center;color:#555;">${s.appear}</td>
        <td style="padding:6px 8px;text-align:center;color:#555;">${s.cleared}</td>
        <td style="padding:6px 8px;">
          <span style="color:${barColor};font-weight:bold;font-size:14px;">${failPct}%</span>
          <div style="background:#e0e0e0;height:5px;border-radius:3px;margin-top:3px;">
            <div style="background:${barColor};height:5px;border-radius:3px;width:${failPct}%;"></div>
          </div>
        </td>
      </tr>`;
    }
    html += `</tbody></table>`;
    if (list.length > showCount) {
      html += `<p style="color:#888;margin-top:8px;">（僅顯示前 ${showCount} 筆，共 ${list.length} 筆）</p>`;
    }
  }

  statsDisplay.style.display = "block";
  statsDisplay.innerHTML = html;

  document.getElementById("_statsShowAll")?.addEventListener("click", () => {
    statsFilterAbove50 = false;
    renderStatsDisplay();
  });
  document.getElementById("_statsShow50")?.addEventListener("click", () => {
    statsFilterAbove50 = true;
    renderStatsDisplay();
  });
}

// ── 立即載入：從 Google Sheets 載入失敗率 > 50% 的 word ──

let _loadedFailedWords = []; // 載入的失敗 word 列表

tapBind(loadFailedBtn, async () => {
  failedWordsArea.style.display = "block";
  failedWordsArea.innerHTML = '<p style="color:#666;">⏳ 正在從 Google Sheets 載入失敗率 &gt; 50% 的組合...</p>';
  loadFailedBtn.disabled = true;
  loadFailedBtn.textContent = "載入中...";
  try {
    const data = await fetchStatsFromSheets("failed50");
    if (!data.ok) throw new Error(data.error || "未知錯誤");
    _loadedFailedWords = (data.words || []).map(w => ({
      // display 格式：「中文提示,word1,word2,...」→ 取 word 部分作為 combo
      raw: w.display || w.comboKey || "",
      comboKey: w.comboKey || "",
      failRate: w.failRate || 0,
      appear: w.appear || 0,
      cleared: w.cleared || 0,
      // 單字模式：origRow 保留原始 2 欄格式（中文,德文），回填時優先使用
      origRow: w.origRow || "",
    }));
    if (_loadedFailedWords.length === 0) {
      failedWordsArea.innerHTML = '<p style="color:#2e7d32;font-weight:bold;">🎉 太棒了！沒有失敗率超過 50% 的組合。</p>';
      return;
    }
    renderFailedWords();
    setMessage(`✅ 已從 Google Sheets 載入 ${_loadedFailedWords.length} 組失敗率 > 50% 的單字。可手動移除不需要的，再按「儲存」生效。`, true);
  } catch (e) {
    const msg = e.message || "未知錯誤";
    const htmlMsg = escapeHtml(msg).replace(/\n/g, "<br>");
    failedWordsArea.innerHTML = `<p style="color:#c62828;white-space:pre-wrap;">❌ ${htmlMsg}</p>`;
  } finally {
    loadFailedBtn.disabled = false;
    loadFailedBtn.textContent = "立即載入";
  }
});

/** 將 _loadedFailedWords 項目轉成可用的 row 字串 */
function _failedWordToRow(w) {
  if (w.origRow) return normalizeRowString(w.origRow);
  const parts = w.raw.split(",");
  if (parts.length >= 2) return normalizeRowString(w.raw);
  return normalizeRowString(w.comboKey);
}

function renderFailedWords() {
  if (_loadedFailedWords.length === 0) {
    failedWordsArea.style.display = "none";
    return;
  }
  let html = `<div style="padding:10px 14px;background:#fff3e0;border-radius:8px;border:1px solid #ffe0b2;">`;
  html += `<div style="font-weight:bold;color:#e65100;margin-bottom:8px;">📥 已載入失敗率 &gt; 50% 的組合（${_loadedFailedWords.length} 組）</div>`;
  html += `<div style="font-size:12px;color:#888;margin-bottom:8px;">請先手動移除不需要的項目，再選擇「加入」或「取代」，最後按「儲存」生效。</div>`;
  html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">`;
  html += `<button id="_addFailedToList" style="background:#e65100;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">全部加入單字列表</button>`;
  html += `<button id="_replaceFailedToList" style="background:#c62828;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">全部取代單字列表</button>`;
  html += `<button id="_clearFailed" style="background:#fff;color:#888;border:1px solid #ccc;padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;">清除</button>`;
  html += `</div>`;
  html += `<div style="max-height:200px;overflow-y:auto;">`;
  for (let i = 0; i < _loadedFailedWords.length; i++) {
    const w = _loadedFailedWords[i];
    const failPct = (w.failRate * 100).toFixed(0);
    const barColor = w.failRate > 0.7 ? "#c62828" : "#e65100";
    // 優先用 origRow 顯示（單字模式下是原始 2 欄格式）
    const displayStr = w.origRow || w.raw;
    const parts = displayStr.split(",");
    let label;
    if (parts.length >= 2) {
      label = `<span style="color:#1565c0;font-weight:600;">${escapeHtml(parts.slice(1).join(", "))}</span>` +
              ` <span style="color:#888;font-size:11px;">(${escapeHtml(parts[0])})</span>`;
    } else {
      label = `<span style="color:#333;">${escapeHtml(displayStr)}</span>`;
    }
    html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f0f0f0;" data-failed-idx="${i}">
      <button class="_removeFailedItem" data-idx="${i}" style="background:none;border:1px solid #ccc;color:#c62828;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">移除</button>
      ${label}
      <span style="margin-left:auto;color:${barColor};font-weight:bold;font-size:12px;">${failPct}%</span>
    </div>`;
  }
  html += `</div></div>`;

  failedWordsArea.innerHTML = html;

  // ── 「全部加入」按鈕：合併到現有單字列表 ──
  document.getElementById("_addFailedToList")?.addEventListener("click", () => {
    let added = 0;
    for (const w of _loadedFailedWords) {
      const wordRow = _failedWordToRow(w);
      if (!isValidRowString(wordRow)) continue;
      const normKey = wordRow.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
      const exists = displayRows.some(r => {
        const norm = r.text.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
        return norm === normKey;
      });
      if (!exists) {
        displayRows.push({ text: wordRow, source: "custom" });
        customRows.push(wordRow);
        customRowsFull.push(wordRow);
        added++;
      }
    }
    if (!customActive) {
      customActive = true;
      updateSourceUI();
    }
    saveCustomRowsFull();
    renderRows();
    _loadedFailedWords = [];
    failedWordsArea.style.display = "none";
    setMessage(`✅ 已合併 ${added} 組到單字列表。按「儲存」生效。`, true);
  });

  // ── 「全部取代」按鈕：用載入的字完全取代現有單字列表 ──
  document.getElementById("_replaceFailedToList")?.addEventListener("click", () => {
    const newCustomRows = [];
    for (const w of _loadedFailedWords) {
      const wordRow = _failedWordToRow(w);
      if (!isValidRowString(wordRow)) continue;
      // 去重
      const normKey = wordRow.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
      const exists = newCustomRows.some(r => {
        const norm = r.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).join(",");
        return norm === normKey;
      });
      if (!exists) newCustomRows.push(wordRow);
    }
    // 取代記憶體中的自定義列表
    customRows = [...newCustomRows];
    customRowsFull = [...newCustomRows];
    // 重建 displayRows：移除舊 custom，加入新的
    displayRows = displayRows.filter(r => r.source !== "custom");
    for (const w of newCustomRows) {
      displayRows.push({ text: w, source: "custom" });
    }
    if (!customActive) {
      customActive = true;
    }
    saveCustomRowsFull();
    updateSourceUI();
    renderRows();
    _loadedFailedWords = [];
    failedWordsArea.style.display = "none";
    setMessage(`🔄 已用 ${newCustomRows.length} 組取代整個自定義單字列表。按「儲存」生效。`, true);
  });

  // ── 「清除」按鈕 ──
  document.getElementById("_clearFailed")?.addEventListener("click", () => {
    _loadedFailedWords = [];
    failedWordsArea.style.display = "none";
  });

  // ── 個別「移除」按鈕（事件代理） ──
  failedWordsArea.addEventListener("click", (e) => {
    const btn = e.target.closest("._removeFailedItem");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (idx >= 0 && idx < _loadedFailedWords.length) {
      _loadedFailedWords.splice(idx, 1);
      renderFailedWords();
    }
  });
}

// ── 清除統計 ──

tapBind(clearStatsBtn, () => {
  if (confirm("確定要清除所有學習統計資料嗎？此操作無法還原。\n（僅清除本機資料，Google Sheets 資料不受影響）")) {
    localStorage.removeItem(STATS_KEY);
    statsDisplay.style.display = "none";
    _cachedSheetStats = null;
    setMessage("已清除本機統計資料。", true);
  }
});

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── 初始化 ──

async function initSettingsPage() {
  await loadWordData();

  GROUP_CATEGORIES_CONFIG = buildGroupCategoriesConfig();
  _letterMap = buildLetterMap();
  _lettersSorted = Object.keys(_letterMap).sort();

  customRows = loadCustomRows();
  customRowsFull = loadCustomRowsFull();
  activeGroups = loadActiveGroups();
  customActive = loadCustomActive();
  singleWordMode = loadSingleWordMode();
  sentenceMode = localStorage.getItem(SENTENCE_MODE_KEY) === "1";
  activeSentenceCats = loadSentenceCats();
  splitMode = loadSplitMode();
  activeLetters = loadActiveLetters();
  activeGroupCats = {};
  for (const _gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    activeGroupCats[parseInt(_gi)] = loadGroupCats(parseInt(_gi));
  }

  // 綁定事件
  tapBind(addBtn, addRow);
  tapBind(saveBtn, saveRows);
  tapBind(resetBtn, resetDefault);
  newRowInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addRow();
  });

  groupBtns.forEach(btn => {
    tapBind(btn, () => {
      const gi = parseInt(btn.dataset.group, 10);
      toggleGroup(gi);
    });
  });
  tapBind(customSourceBtn, toggleCustom);
  tapBind(singleWordModeBtn, toggleSingleWordMode);
  const _sentenceModeBtn = document.getElementById("sentenceModeBtn");
  if (_sentenceModeBtn) tapBind(_sentenceModeBtn, toggleSentenceMode);
  splitModeBtns.forEach(btn => {
    tapBind(btn, () => {
      splitMode = btn.dataset.split;
      updateSourceUI();
      setMessage(`拆分模式已切換為「${
        splitMode === "syllable" ? "音節拆分" :
        splitMode === "random" ? "隨機拆分" :
        splitMode === "letter" ? "逐字母拆分" : "混合"
      }」，按「儲存」生效。`);
    });
  });

  preventZoom();
  pickCount = loadPickCount(); // 載入已儲存的抽取組數（sample 漏掉,會被歸零）
  pickCountInput.value = pickCount;
  debugToggle.checked = localStorage.getItem(DEBUG_KEY) === "1";
  autoRemoveToggle.checked = localStorage.getItem(AUTO_REMOVE_KEY) === "1";
  battleModeToggle.checked = localStorage.getItem(BATTLE_MODE_KEY) === "1";

  debugToggle.addEventListener("change", () => {
    localStorage.setItem(DEBUG_KEY, debugToggle.checked ? "1" : "0");
    updateDebugPoolStatus();
  });

  const _savedLens = loadAllowedLens();
  len2Toggle.checked = _savedLens.includes(2);
  len3Toggle.checked = _savedLens.includes(3);
  len4Toggle.checked = _savedLens.includes(4);
  len5Toggle.checked = _savedLens.includes(5);

  buildDisplayRows();
  if (singleWordMode) {
    renderLetterBar();
  }
  if (sentenceMode) {
    renderSentenceCatBar();
  }
  for (const _gi of Object.keys(GROUP_CATEGORIES_CONFIG)) {
    const gi = parseInt(_gi);
    if (activeGroups.has(gi)) {
      renderGroupCatBar(gi);
    }
  }
  updateSourceUI();
  renderRows();
}

initSettingsPage();

