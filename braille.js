// braille.js — 日本語点字(6点式)の変換テーブルと双方向変換
//
// 準拠: 日本点字表記法(日本点字委員会)・日本点字図書館「点字一覧表」
//
// ドット番号の配置:      ビット割当:
//   1 4                  bit0=点1, bit1=点2, bit2=点3,
//   2 5                  bit3=点4, bit4=点5, bit5=点6
//   3 6
//
// 同形符号の文脈判別(重要):
//   5,6     = 外字符(後続が英字) / 読点「、」(後続がマス空け)
//   2,6     = 特殊音符(後続が対応かな) / 疑問符「?」
//   2,5,6   = 濁特殊音符(後続がか行・は行) / 句点「。」
//   5       = 濁音符(後続がかな) / 中点「・」(後続がマス空け)

"use strict";

function m(...dots) {
  let mask = 0;
  for (const d of dots) mask |= 1 << (d - 1);
  return mask;
}

// ---- 特殊符号 ----
const SIGN = {
  DAKU: m(5),              // 濁音符 ⠐ (後続空白なら中点)
  HANDAKU: m(6),           // 半濁音符 ⠠
  YOON: m(4),              // 拗音符 ⠈
  YOON_DAKU: m(4, 5),      // 拗濁音符 ⠘
  YOON_HANDAKU: m(4, 6),   // 拗半濁音符 ⠨
  SPECIAL: m(2, 6),        // 特殊音符 ⠢ (後続空白なら疑問符)
  SPECIAL_DAKU: m(2, 5, 6),// 濁特殊音符 ⠲ (後続空白なら句点)
  NUMBER: m(3, 4, 5, 6),   // 数符 ⠼
  GAIJI: m(5, 6),          // 外字符 ⠰ (後続空白なら読点)
  QUOTE_OPEN: m(2, 3, 6),  // 外国語引用符(開き) ⠦
  QUOTE_CLOSE: m(3, 5, 6), // 外国語引用符(閉じ) ⠴
  CAPITAL: m(6),           // 大文字符(外字モード内)
  TSUNAGI: m(3, 6),        // 第1つなぎ符 ⠤
  KAGI: m(2, 3, 5, 6),     // 第1カギ ⠶ (開閉同形)
};

// ---- 清音・記号(マスク → 文字) ----
const KANA = new Map([
  [m(1), "あ"], [m(1, 2), "い"], [m(1, 4), "う"], [m(1, 2, 4), "え"], [m(2, 4), "お"],
  [m(1, 6), "か"], [m(1, 2, 6), "き"], [m(1, 4, 6), "く"], [m(1, 2, 4, 6), "け"], [m(2, 4, 6), "こ"],
  [m(1, 5, 6), "さ"], [m(1, 2, 5, 6), "し"], [m(1, 4, 5, 6), "す"], [m(1, 2, 4, 5, 6), "せ"], [m(2, 4, 5, 6), "そ"],
  [m(1, 3, 5), "た"], [m(1, 2, 3, 5), "ち"], [m(1, 3, 4, 5), "つ"], [m(1, 2, 3, 4, 5), "て"], [m(2, 3, 4, 5), "と"],
  [m(1, 3), "な"], [m(1, 2, 3), "に"], [m(1, 3, 4), "ぬ"], [m(1, 2, 3, 4), "ね"], [m(2, 3, 4), "の"],
  [m(1, 3, 6), "は"], [m(1, 2, 3, 6), "ひ"], [m(1, 3, 4, 6), "ふ"], [m(1, 2, 3, 4, 6), "へ"], [m(2, 3, 4, 6), "ほ"],
  [m(1, 3, 5, 6), "ま"], [m(1, 2, 3, 5, 6), "み"], [m(1, 3, 4, 5, 6), "む"], [m(1, 2, 3, 4, 5, 6), "め"], [m(2, 3, 4, 5, 6), "も"],
  [m(3, 4), "や"], [m(3, 4, 6), "ゆ"], [m(3, 4, 5), "よ"],
  [m(1, 5), "ら"], [m(1, 2, 5), "り"], [m(1, 4, 5), "る"], [m(1, 2, 4, 5), "れ"], [m(2, 4, 5), "ろ"],
  [m(3), "わ"], [m(3, 5), "を"], [m(3, 5, 6), "ん"],
  [m(2), "っ"], [m(2, 5), "ー"],
  [m(2, 3, 5), "!"],
]);

// ---- 濁音・半濁音の変換(清音 → 変化形) ----
const DAKU_MAP = new Map(Object.entries({
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
  う: "ヴ",
}));
const HANDAKU_MAP = new Map(Object.entries({
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
}));

// ---- 拗音(拗音符4 + 清音)。え段・い段の特殊音も同じ前置符号を使う ----
const YOON_MAP = new Map(Object.entries({
  か: "きゃ", く: "きゅ", こ: "きょ",
  さ: "しゃ", す: "しゅ", そ: "しょ",
  た: "ちゃ", つ: "ちゅ", と: "ちょ",
  な: "にゃ", ぬ: "にゅ", の: "にょ",
  は: "ひゃ", ふ: "ひゅ", ほ: "ひょ",
  ま: "みゃ", む: "みゅ", も: "みょ",
  ら: "りゃ", る: "りゅ", ろ: "りょ",
  // 特殊音(イ段・エ段)
  え: "イェ", け: "キェ", せ: "シェ", て: "チェ", ね: "ニェ", へ: "ヒェ",
  し: "スィ", ち: "ティ", つ: "トゥ",
}));
const YOON_DAKU_MAP = new Map(Object.entries({
  か: "ぎゃ", く: "ぎゅ", こ: "ぎょ",
  さ: "じゃ", す: "じゅ", そ: "じょ",
  た: "ぢゃ", つ: "ぢゅ", と: "ぢょ",
  は: "びゃ", ふ: "びゅ", ほ: "びょ",
  せ: "ジェ", し: "ズィ", ち: "ディ", つ: "ドゥ",
}));
const YOON_HANDAKU_MAP = new Map(Object.entries({
  は: "ぴゃ", ふ: "ぴゅ", ほ: "ぴょ",
}));

// ---- 特殊音符(2,6) + 清音 ----
const SPECIAL_MAP = new Map(Object.entries({
  い: "ウィ", え: "ウェ", お: "ウォ",
  か: "クァ", き: "クィ", け: "クェ", こ: "クォ",
  た: "ツァ", ち: "ツィ", て: "ツェ", と: "ツォ",
  は: "ファ", ひ: "フィ", へ: "フェ", ほ: "フォ",
}));
// ---- 濁特殊音符(2,5,6) + 清音 ----
const SPECIAL_DAKU_MAP = new Map(Object.entries({
  か: "グァ", き: "グィ", け: "グェ", こ: "グォ",
  は: "ヴァ", ひ: "ヴィ", へ: "ヴェ", ほ: "ヴォ",
}));

// ---- 数字(数符のあと)----
const DIGITS = new Map([
  [m(1), "1"], [m(1, 2), "2"], [m(1, 4), "3"], [m(1, 4, 5), "4"], [m(1, 5), "5"],
  [m(1, 2, 4), "6"], [m(1, 2, 4, 5), "7"], [m(1, 2, 5), "8"], [m(2, 4), "9"], [m(2, 4, 5), "0"],
]);

// ---- アルファベット(外字符・外国語引用符のあと)----
const LATIN = new Map([
  [m(1), "a"], [m(1, 2), "b"], [m(1, 4), "c"], [m(1, 4, 5), "d"], [m(1, 5), "e"],
  [m(1, 2, 4), "f"], [m(1, 2, 4, 5), "g"], [m(1, 2, 5), "h"], [m(2, 4), "i"], [m(2, 4, 5), "j"],
  [m(1, 3), "k"], [m(1, 2, 3), "l"], [m(1, 3, 4), "m"], [m(1, 3, 4, 5), "n"], [m(1, 3, 5), "o"],
  [m(1, 2, 3, 4), "p"], [m(1, 2, 3, 4, 5), "q"], [m(1, 2, 3, 5), "r"], [m(2, 3, 4), "s"], [m(2, 3, 4, 5), "t"],
  [m(1, 3, 6), "u"], [m(1, 2, 3, 6), "v"], [m(2, 4, 5, 6), "w"], [m(1, 3, 4, 6), "x"], [m(1, 3, 4, 5, 6), "y"], [m(1, 3, 5, 6), "z"],
]);

// プレフィックス → 変換表とラベル
const PREFIX_INFO = new Map([
  [SIGN.DAKU, { map: DAKU_MAP, label: "濁" }],
  [SIGN.HANDAKU, { map: HANDAKU_MAP, label: "半" }],
  [SIGN.YOON, { map: YOON_MAP, label: "拗" }],
  [SIGN.YOON_DAKU, { map: YOON_DAKU_MAP, label: "拗濁" }],
  [SIGN.YOON_HANDAKU, { map: YOON_HANDAKU_MAP, label: "拗半" }],
  [SIGN.SPECIAL, { map: SPECIAL_MAP, label: "特" }],
  [SIGN.SPECIAL_DAKU, { map: SPECIAL_DAKU_MAP, label: "特濁" }],
]);

// 「プレフィックスとして解釈できなかったときの記号読み」
const SIGN_FALLBACK = new Map([
  [SIGN.SPECIAL, "?"],       // 疑問符
  [SIGN.SPECIAL_DAKU, "。"], // 句点
  [SIGN.GAIJI, "、"],        // 読点
  [SIGN.DAKU, "・"],         // 中点
]);

// マスク列(1マス=1マスク、0=空白マス)を墨字に変換する。
// 戻り値: { text, perCell: [{mask, label}] }
function decodeCells(masks) {
  let text = "";
  let mode = "kana";      // kana | num | latin
  let latinQuote = false; // 外国語引用符(⠦〜⠴)の中か
  let capitalNext = false, capsAll = false;
  let kagiOpen = false;
  const perCell = [];
  const push = (label) => perCell.push({ label });

  // 次の空白でないマスを先読み(同形符号の文脈判別に使う)
  const lookahead = (i) => (i + 1 < masks.length ? masks[i + 1] : 0);

  let i = 0;
  while (i < masks.length) {
    const mask = masks[i];

    if (mask === 0) { // 空白マス
      mode = "kana";
      latinQuote = false; capitalNext = false; capsAll = false;
      // 句読点等の直後のマス空けは墨字では空白にしない
      if (!text.endsWith(" ") && !"、。?!・".includes(text.slice(-1)) && text.length) text += " ";
      push("␣"); i++; continue;
    }

    // ---- 数字モード ----
    if (mode === "num") {
      const dg = DIGITS.get(mask);
      if (dg) { text += dg; push(dg); i++; continue; }
      if (mask === m(2) && DIGITS.has(lookahead(i))) { text += "."; push("."); i++; continue; }
      if (mask === m(3) && DIGITS.has(lookahead(i))) { text += ","; push(","); i++; continue; }
      if (mask === SIGN.TSUNAGI) { mode = "kana"; push("繋"); i++; continue; }
      mode = "kana"; // 読み直し
    }

    // ---- 英字モード ----
    if (mode === "latin") {
      if (latinQuote && mask === SIGN.QUOTE_CLOSE) {
        mode = "kana"; latinQuote = false; push("〞"); i++; continue;
      }
      if (mask === SIGN.CAPITAL) {
        if (capitalNext) capsAll = true;
        capitalNext = true;
        push("大"); i++; continue;
      }
      if (mask === SIGN.NUMBER) { mode = "num"; push("数"); i++; continue; }
      const ch = LATIN.get(mask);
      if (ch) {
        const up = capitalNext || capsAll;
        if (!capsAll) capitalNext = false;
        text += up ? ch.toUpperCase() : ch;
        push(up ? ch.toUpperCase() : ch);
        i++; continue;
      }
      if (mask === SIGN.TSUNAGI) { mode = "kana"; push("繋"); i++; continue; }
      mode = "kana"; capitalNext = false; capsAll = false; // 読み直し
    }

    // ---- 仮名モード ----
    if (mask === SIGN.NUMBER) { mode = "num"; push("数"); i++; continue; }

    if (mask === SIGN.QUOTE_OPEN) {
      mode = "latin"; latinQuote = true; push("〝"); i++; continue;
    }
    if (mask === SIGN.KAGI) {
      text += kagiOpen ? "」" : "「";
      push(kagiOpen ? "」" : "「");
      kagiOpen = !kagiOpen;
      i++; continue;
    }

    // 外字符(5,6): 後続が英字(or 大文字符)なら英字モード、そうでなければ読点
    if (mask === SIGN.GAIJI) {
      const nx = lookahead(i);
      if (LATIN.has(nx) || nx === SIGN.CAPITAL) {
        mode = "latin"; latinQuote = false; push("外"); i++; continue;
      }
      text += "、"; push("、"); i++; continue;
    }

    // プレフィックス類(濁音符・拗音符・特殊音符など): 次のマスと合成
    const pinfo = PREFIX_INFO.get(mask);
    if (pinfo && !KANA.has(mask)) {
      const nx = lookahead(i);
      const base = KANA.get(nx);
      const composed = base != null ? pinfo.map.get(base) : undefined;
      if (composed) {
        text += composed;
        push(pinfo.label); push(composed);
        i += 2; continue;
      }
      // 合成できない → 記号としての読みにフォールバック
      const fb = SIGN_FALLBACK.get(mask);
      if (fb) { text += fb; push(fb); i++; continue; }
      text += "?"; push("?"); i++; continue;
    }

    const base = KANA.get(mask);
    if (base) { text += base; push(base); i++; continue; }

    // 単独の記号読みが定義されているもの(句点・疑問符など)
    const fb = SIGN_FALLBACK.get(mask);
    if (fb) { text += fb; push(fb); i++; continue; }

    text += "?"; push("?"); i++; continue;
  }
  return { text: text.trim(), perCell };
}

// ---- エンコード(デモ画像生成・検証用): テキスト → マスク列 ----

const KANA_INV = new Map();
for (const [mask, ch] of KANA) if (!KANA_INV.has(ch)) KANA_INV.set(ch, mask);

const COMPOSED_INV = new Map(); // 合成文字 → [プレフィックス, 清音マスク]
for (const [sign, { map }] of PREFIX_INFO) {
  for (const [base, ch] of map) {
    if (!COMPOSED_INV.has(ch)) COMPOSED_INV.set(ch, [sign, KANA_INV.get(base)]);
  }
}
// カタカナ表記の特殊音(ファ等)に、ひらがな表記(ふぁ等)のキーも足す
for (const [ch, v] of [...COMPOSED_INV]) {
  const h = ch.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  if (!COMPOSED_INV.has(h)) COMPOSED_INV.set(h, v);
}

const DIGIT_INV = new Map();
for (const [mask, ch] of DIGITS) DIGIT_INV.set(ch, mask);
const LATIN_INV = new Map();
for (const [mask, ch] of LATIN) LATIN_INV.set(ch, mask);

function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// テキスト → マスク列(行ごと)。カタカナ特殊音は COMPOSED_INV が
// カタカナのキー(ファ等)を持つので、ひらがな化の前に照合する。
function encodeText(input) {
  const lines = [];
  for (const rawLine of input.split("\n")) {
    const masks = [];
    let mode = "kana";
    let kagiOpen = false;
    let i = 0;
    while (i < rawLine.length) {
      const two = rawLine.slice(i, i + 2);
      const one = rawLine[i];
      const twoH = kataToHira(two);
      const oneH = kataToHira(one);

      if (one === " " || one === "　") { masks.push(0); mode = "kana"; i++; continue; }
      if (/[0-9]/.test(one)) {
        if (mode !== "num") { masks.push(SIGN.NUMBER); mode = "num"; }
        masks.push(DIGIT_INV.get(one)); i++; continue;
      }
      if (/[a-zA-Z]/.test(one)) {
        if (mode !== "latin") { masks.push(SIGN.GAIJI); mode = "latin"; }
        if (/[A-Z]/.test(one)) masks.push(SIGN.CAPITAL);
        masks.push(LATIN_INV.get(one.toLowerCase())); i++; continue;
      }
      if (one === "「" || one === "」" || one === "『" || one === "』") {
        masks.push(SIGN.KAGI); kagiOpen = !kagiOpen; mode = "kana"; i++; continue;
      }
      if (one === "、") { masks.push(SIGN.GAIJI); masks.push(0); mode = "kana"; i++; continue; }
      if (one === "。") { masks.push(SIGN.SPECIAL_DAKU); masks.push(0); mode = "kana"; i++; continue; }
      if (one === "?" || one === "?") { masks.push(SIGN.SPECIAL); masks.push(0); mode = "kana"; i++; continue; }
      if (one === "!" || one === "!") { masks.push(m(2, 3, 5)); mode = "kana"; i++; continue; }
      if (one === "・") { masks.push(SIGN.DAKU); masks.push(0); mode = "kana"; i++; continue; }
      mode = "kana";
      // 特殊音・拗音・濁音(カタカナ優先で2文字→1文字の順に照合)
      let hit = null, len = 0;
      if (COMPOSED_INV.has(two)) { hit = COMPOSED_INV.get(two); len = 2; }
      else if (COMPOSED_INV.has(twoH)) { hit = COMPOSED_INV.get(twoH); len = 2; }
      else if (COMPOSED_INV.has(one)) { hit = COMPOSED_INV.get(one); len = 1; }
      else if (COMPOSED_INV.has(oneH)) { hit = COMPOSED_INV.get(oneH); len = 1; }
      if (hit) { masks.push(...hit); i += len; continue; }
      if (KANA_INV.has(oneH)) { masks.push(KANA_INV.get(oneH)); i++; continue; }
      i++; // 未対応文字はスキップ
    }
    lines.push(masks);
  }
  return lines;
}

window.Braille = { m, SIGN, KANA, DIGITS, LATIN, decodeCells, encodeText };
