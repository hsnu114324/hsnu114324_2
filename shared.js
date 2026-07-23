// ══════════════════════════════════════════════════════════════
// Word Tetris 共用模組（index.html 與 settings.html 都會載入）
// 依賴：data/words.js 需先載入（提供 window.WORD_DATA）
// ══════════════════════════════════════════════════════════════

// ── localStorage 鍵 ──
const STORAGE_KEY = "word_tetris_rows_v1";              // 自定義列（遊戲實際使用）
const CUSTOM_FULL_KEY = "word_tetris_custom_full_v1";   // 自定義完整快照
const CUSTOM_ACTIVE_KEY = "word_tetris_custom_active_v1";
const PICK_KEY = "word_tetris_pick_v1";
const DEBUG_KEY = "word_tetris_debug_v1";
const LENS_KEY = "word_tetris_lens_v1";
const AUTO_REMOVE_KEY = "word_tetris_auto_remove_v1";
const BATTLE_MODE_KEY = "word_tetris_battle_v1";
const GROUPS_KEY = "word_tetris_groups_v1";
const GROUP_DATA_KEY = "word_tetris_group_data_v1";
const GROUP_REMOVED_KEY = "word_tetris_group_removed_v1";
const SINGLE_WORD_MODE_KEY = "word_tetris_single_word_v1";
const SPLIT_MODE_KEY = "word_tetris_split_mode_v1";
const WORD_LETTERS_KEY = "word_tetris_letters_v1";
const SENTENCE_MODE_KEY = "word_tetris_sentence_mode_v1";
const SENTENCE_DATA_KEY = "word_tetris_sentence_data_v1";
const SENTENCE_CATS_KEY = "word_tetris_sentence_cats_v1";
const STATS_KEY = "word_tetris_stats_v1";
const GOOGLE_USER_KEY = "word_tetris_google_user_v1";

// Google Apps Script 端點（留空 = 統計只存本機）
const APPS_SCRIPT_URL = "";

// ── 首次啟動預設：啟用群組 1（B1 中德配對），每局隨機抽 20 組 ──
(function initFirstRunDefaults() {
  try {
    const hasAnyConfig =
      localStorage.getItem(GROUPS_KEY) !== null ||
      localStorage.getItem(CUSTOM_ACTIVE_KEY) !== null ||
      localStorage.getItem(SINGLE_WORD_MODE_KEY) !== null ||
      localStorage.getItem(SENTENCE_MODE_KEY) !== null;
    if (!hasAnyConfig) {
      localStorage.setItem(GROUPS_KEY, JSON.stringify([0]));
      localStorage.setItem(PICK_KEY, "20");
      localStorage.setItem(LENS_KEY, JSON.stringify([2, 3, 4, 5]));
    }
  } catch (e) { /* ignore */ }
})();

// ── 基本設定讀取 ──

function isValidRowString(row) {
  if (typeof row !== "string") return false;
  const parts = row.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 5;
}

function isCustomActive() {
  return localStorage.getItem(CUSTOM_ACTIVE_KEY) === "1";
}

function isSingleWordMode() {
  return localStorage.getItem(SINGLE_WORD_MODE_KEY) === "1";
}

function isAutoRemoveMode() {
  return localStorage.getItem(AUTO_REMOVE_KEY) === "1";
}

function loadSplitMode() {
  const m = localStorage.getItem(SPLIT_MODE_KEY);
  return ["syllable", "random", "mixed", "letter"].includes(m) ? m : "syllable";
}

function loadPickCount() {
  const n = parseInt(localStorage.getItem(PICK_KEY) || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 遊戲頁版本：回傳陣列（settings.js 會用自己的 Set 版本覆寫）
function loadActiveGroups() {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => Number.isInteger(n) && n >= 0 && n < 5);
  } catch (e) {
    return [];
  }
}

// 群組資料：優先用設定頁儲存的（含分類篩選），否則用內建字庫
function loadGroupData() {
  try {
    const raw = localStorage.getItem(GROUP_DATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length >= 1 && parsed.every(Array.isArray)) {
        return parsed;
      }
    }
  } catch (e) { /* ignore */ }
  if (window.WORD_DATA && Array.isArray(window.WORD_DATA.groups)) {
    return window.WORD_DATA.groups.map((g) => [...g]);
  }
  return [[], [], [], [], []];
}

function loadGroupRemoved() {
  try {
    const raw = localStorage.getItem(GROUP_REMOVED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveGroupRemoved(obj) {
  try {
    localStorage.setItem(GROUP_REMOVED_KEY, JSON.stringify(obj));
  } catch (e) { /* ignore */ }
}

// ── 學習統計（本機） ──

function loadComboStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveComboStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) { /* ignore */ }
}

// 統計同步：未設定 APPS_SCRIPT_URL 時為 no-op（統計仍存於本機 STATS_KEY）
function syncStatsToSheets() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("YOUR_")) return;
  try {
    const user = JSON.parse(localStorage.getItem(GOOGLE_USER_KEY) || "null");
    if (!user || !user.email) return;
    fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "sync", email: user.email, stats: loadComboStats() }),
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

// ── 德文拆字 ──

// 將單一 token 依德文音節規則拆開（啟發式）
function splitSyllables(word) {
  const w = String(word);
  const lower = w.toLowerCase();
  const isVowel = (i) => "aeiouyäöü".includes(lower[i]);
  const DIPHTHONGS = ["au", "ei", "ie", "eu", "äu", "ai", "oi", "ui", "ee", "aa", "oo"];

  // 母音核心（雙母音算一個）
  const nuclei = [];
  let i = 0;
  while (i < w.length) {
    if (isVowel(i)) {
      let end = i;
      if (i + 1 < w.length && isVowel(i + 1) && DIPHTHONGS.includes(lower.slice(i, i + 2))) {
        end = i + 1;
      }
      nuclei.push([i, end]);
      i = end + 1;
    } else {
      i++;
    }
  }
  if (nuclei.length <= 1) return [w];

  // 不可拆開的子音組合（sch/ch/ck/ph/th/qu 視為一個音）
  const NEVER_SPLIT = ["sch", "ch", "ck", "ph", "th", "qu"];
  const cuts = [];
  for (let n = 0; n + 1 < nuclei.length; n++) {
    const cStart = nuclei[n][1] + 1;
    const cEnd = nuclei[n + 1][0] - 1;
    let cut;
    if (cStart > cEnd) {
      cut = nuclei[n + 1][0]; // 母音相接：新音節從下一核心開始
    } else {
      cut = cEnd; // 預設：最後一個子音歸下一音節
      const tri = lower.slice(cEnd - 2, cEnd + 1);
      const duo = lower.slice(cEnd - 1, cEnd + 1);
      if (NEVER_SPLIT.includes(tri)) cut = cEnd - 2;
      else if (NEVER_SPLIT.includes(duo)) cut = cEnd - 1;
      if (cut < cStart) cut = cStart;
    }
    cuts.push(cut);
  }

  const parts = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev) {
      parts.push(w.slice(prev, c));
      prev = c;
    }
  }
  parts.push(w.slice(prev));
  return parts.filter(Boolean);
}

// 隨機拆一個 token 成 2~4 塊
function splitTokenRandom(tok) {
  if (tok.length <= 2) return [tok];
  const n = Math.min(2 + Math.floor(Math.random() * 3), tok.length);
  const cuts = new Set();
  let guard = 0;
  while (cuts.size < n - 1 && guard++ < 50) {
    cuts.add(1 + Math.floor(Math.random() * (tok.length - 1)));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const parts = [];
  let prev = 0;
  for (const c of sorted) {
    parts.push(tok.slice(prev, c));
    prev = c;
  }
  parts.push(tok.slice(prev));
  return parts.filter(Boolean);
}

// 冠詞（陰陽中性 der/das/die 及其變格）永遠保持完整方塊，任何模式都不拆分、不與其他塊合併
const GERMAN_ARTICLES = new Set([
  "der", "die", "das", "den", "dem", "des",
]);

function isArticleToken(tok) {
  return GERMAN_ARTICLES.has(String(tok).toLowerCase());
}

/**
 * 把德文單字（可含冠詞，如 "der Ordner"）拆成方塊序列。
 * 模式由 loadSplitMode() 決定：syllable / random / mixed / letter
 * 規則：冠詞 der/das/die 一律整塊保留（不拆分、不合併）。
 * @param {string} text 德文（可含空格）
 * @param {number} maxBlocks 最大方塊數（音節模式 4、逐字母模式 30）
 */
function splitGermanToBlocks(text, maxBlocks) {
  const mode = loadSplitMode();
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [String(text)];

  // 逐字母模式：每個字母一塊（盤面上限 14 欄 → 方塊數上限 13）
  if (mode === "letter") {
    const cap = Math.max(2, Math.min(maxBlocks || 30, 13));
    const pieces = [];
    tokens.forEach((tok, ti) => {
      if (isArticleToken(tok)) {
        pieces.push({ text: tok, tok: ti, atomic: true }); // 冠詞整塊
      } else {
        for (const ch of tok) pieces.push({ text: ch, tok: ti });
      }
    });
    // 超過上限 → 只在同一單字內合併（挑塊數最多的單字，從頭兩塊合起）
    // 冠詞永遠只有 1 塊，不會成為合併對象
    while (pieces.length > cap) {
      const counts = {};
      for (const p of pieces) {
        if (p.atomic) continue;
        counts[p.tok] = (counts[p.tok] || 0) + 1;
      }
      let bestTok = -1;
      let bestCnt = 1;
      for (const t in counts) {
        if (counts[t] > bestCnt) { bestCnt = counts[t]; bestTok = Number(t); }
      }
      if (bestTok < 0) break; // 全部單字都只剩 1 塊
      const i = pieces.findIndex((p) => p.tok === bestTok);
      pieces.splice(i, 2, { text: pieces[i].text + pieces[i + 1].text, tok: bestTok });
    }
    return pieces.map((p) => p.text);
  }

  const cap = Math.max(2, maxBlocks || 4);
  const useRandom = mode === "random" || (mode === "mixed" && Math.random() < 0.5);
  const pieces = [];
  tokens.forEach((tok, ti) => {
    if (isArticleToken(tok)) {
      pieces.push({ text: tok, tok: ti, atomic: true }); // 冠詞整塊
      return;
    }
    const parts = useRandom ? splitTokenRandom(tok) : splitSyllables(tok);
    for (const p of parts) pieces.push({ text: p, tok: ti });
  });

  // 塊數過多 → 兩兩合併（優先合併同一 token 內、長度最短的相鄰塊）
  // 冠詞方塊（atomic）不參與任何合併
  while (pieces.length > cap) {
    let bi = -1;
    let bl = Infinity;
    for (let i = 0; i + 1 < pieces.length; i++) {
      if (pieces[i].atomic || pieces[i + 1].atomic) continue;
      const sameTok = pieces[i].tok === pieces[i + 1].tok;
      const l = pieces[i].text.length + pieces[i + 1].text.length + (sameTok ? 0 : 100);
      if (l < bl) { bl = l; bi = i; }
    }
    if (bi < 0) break; // 只剩冠詞相鄰的配對 → 無法再合併
    const a = pieces[bi];
    const b = pieces[bi + 1];
    const joined = a.tok === b.tok ? a.text + b.text : a.text + " " + b.text;
    pieces.splice(bi, 2, { text: joined, tok: a.tok });
  }
  return pieces.map((p) => p.text);
}

// ── 行動裝置工具 ──

/** 手機快速點擊綁定（touchstart 立即觸發，避免 300ms 延遲與 ghost click） */
function tapBind(el, handler) {
  if (!el) return;
  let usedTouch = false;
  el.addEventListener("touchstart", (e) => {
    usedTouch = true;
    e.preventDefault();
    handler(e);
  }, { passive: false });
  el.addEventListener("click", (e) => {
    if (usedTouch) {
      usedTouch = false;
      return;
    }
    handler(e);
  });
}

/** 阻止 iOS 雙擊縮放 / 兩指縮放（iPhone Safari） */
function preventZoom() {
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && e.target && e.target.tagName !== "INPUT") {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}
