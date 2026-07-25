// braille.js — 日本語点字(6点式)の変換テーブルと双方向変換
//
// ドット番号の配置:      ビット割当:
//   1 4                  bit0=点1, bit1=点2, bit2=点3,
//   2 5                  bit3=点4, bit4=点5, bit5=点6
//   3 6

"use strict";

function m(...dots) {
  let mask = 0;
  for (const d of dots) mask |= 1 << (d - 1);
  return mask;
}

// ---- 特殊符号 ----
const SIGN = {
  DAKU: m(5),            // 濁音符 ⠐
  HANDAKU: m(6),         // 半濁音符 ⠠
  YOON: m(4),            // 拗音符 ⠈
  YOON_DAKU: m(4, 5),    // 拗濁音符 ⠘
  YOON_HANDAKU: m(4, 6), // 拗半濁音符 ⠨
  NUMBER: m(3, 4, 5, 6), // 数符 ⠼
  GAIJI: m(2, 3, 6),     // 外字符 ⠦
  CAPITAL: m(6),         // 大文字符(外字モード内)
  TSUNAGI: m(3, 6),      // 第1つなぎ符 ⠤
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
  [m(2, 5, 6), "。"], [m(5, 6), "、"], [m(2, 6), "?"], [m(2, 3, 5), "!"],
]);

// ---- 濁音・半濁音・拗音の変換(清音 → 変化形) ----
const DAKU_MAP = new Map(Object.entries({
  か: "が", き: "ぎ", く: "ぐ", け: "げ", こ: "ご",
  さ: "ざ", し: "じ", す: "ず", せ: "ぜ", そ: "ぞ",
  た: "だ", ち: "ぢ", つ: "づ", て: "で", と: "ど",
  は: "ば", ひ: "び", ふ: "ぶ", へ: "べ", ほ: "ぼ",
  う: "ゔ",
}));
const HANDAKU_MAP = new Map(Object.entries({
  は: "ぱ", ひ: "ぴ", ふ: "ぷ", へ: "ぺ", ほ: "ぽ",
}));
const YOON_MAP = new Map(Object.entries({
  か: "きゃ", く: "きゅ", こ: "きょ",
  さ: "しゃ", す: "しゅ", そ: "しょ",
  た: "ちゃ", つ: "ちゅ", と: "ちょ",
  な: "にゃ", ぬ: "にゅ", の: "にょ",
  は: "ひゃ", ふ: "ひゅ", ほ: "ひょ",
  ま: "みゃ", む: "みゅ", も: "みょ",
  ら: "りゃ", る: "りゅ", ろ: "りょ",
}));
const YOON_DAKU_MAP = new Map(Object.entries({
  か: "ぎゃ", く: "ぎゅ", こ: "ぎょ",
  さ: "じゃ", す: "じゅ", そ: "じょ",
  た: "ぢゃ", つ: "ぢゅ", と: "ぢょ",
  は: "びゃ", ふ: "びゅ", ほ: "びょ",
}));
const YOON_HANDAKU_MAP = new Map(Object.entries({
  は: "ぴゃ", ふ: "ぴゅ", ほ: "ぴょ",
}));

// ---- 数字(数符のあと)----
const DIGITS = new Map([
  [m(1), "1"], [m(1, 2), "2"], [m(1, 4), "3"], [m(1, 4, 5), "4"], [m(1, 5), "5"],
  [m(1, 2, 4), "6"], [m(1, 2, 4, 5), "7"], [m(1, 2, 5), "8"], [m(2, 4), "9"], [m(2, 4, 5), "0"],
]);

// ---- アルファベット(外字符のあと)----
const LATIN = new Map([
  [m(1), "a"], [m(1, 2), "b"], [m(1, 4), "c"], [m(1, 4, 5), "d"], [m(1, 5), "e"],
  [m(1, 2, 4), "f"], [m(1, 2, 4, 5), "g"], [m(1, 2, 5), "h"], [m(2, 4), "i"], [m(2, 4, 5), "j"],
  [m(1, 3), "k"], [m(1, 2, 3), "l"], [m(1, 3, 4), "m"], [m(1, 3, 4, 5), "n"], [m(1, 3, 5), "o"],
  [m(1, 2, 3, 4), "p"], [m(1, 2, 3, 4, 5), "q"], [m(1, 2, 3, 5), "r"], [m(2, 3, 4), "s"], [m(2, 3, 4, 5), "t"],
  [m(1, 3, 6), "u"], [m(1, 2, 3, 6), "v"], [m(2, 4, 5, 6), "w"], [m(1, 3, 4, 6), "x"], [m(1, 3, 4, 5, 6), "y"], [m(1, 3, 5, 6), "z"],
]);

const PREFIX_LABEL = new Map([
  [SIGN.DAKU, "濁"], [SIGN.HANDAKU, "半"], [SIGN.YOON, "拗"],
  [SIGN.YOON_DAKU, "拗濁"], [SIGN.YOON_HANDAKU, "拗半"],
  [SIGN.NUMBER, "数"], [SIGN.GAIJI, "外"],
]);

// マスク列(1マス=1マスク、0=空白マス)を墨字に変換する。
// 戻り値: { text, perCell: [{mask, label}] }  label はオーバーレイ表示用。
function decodeCells(masks) {
  let text = "";
  let mode = "kana"; // kana | num | latin
  let pendingPrefix = 0;
  let capitalNext = false;
  const perCell = [];

  const flushUnknownPrefix = () => {
    if (pendingPrefix) { text += "?"; pendingPrefix = 0; }
  };

  for (let i = 0; i < masks.length; i++) {
    const mask = masks[i];
    let label = "";

    if (mask === 0) { // 空白マス(マス空け)
      flushUnknownPrefix();
      mode = "kana";
      capitalNext = false;
      if (!text.endsWith(" ")) text += " ";
      perCell.push({ mask, label: "␣" });
      continue;
    }

    if (mode === "num") {
      const d = DIGITS.get(mask);
      if (d) { text += d; perCell.push({ mask, label: d }); continue; }
      if (mask === m(2)) { text += "."; perCell.push({ mask, label: "." }); continue; }
      if (mask === SIGN.TSUNAGI) { mode = "kana"; perCell.push({ mask, label: "繋" }); continue; }
      mode = "kana"; // 数字以外が来たら仮名モードに戻して読み直す
    }

    if (mode === "latin") {
      if (mask === SIGN.CAPITAL) { capitalNext = true; perCell.push({ mask, label: "大" }); continue; }
      const ch = LATIN.get(mask);
      if (ch) {
        const out = capitalNext ? ch.toUpperCase() : ch;
        capitalNext = false;
        text += out;
        perCell.push({ mask, label: out });
        continue;
      }
      mode = "kana"; // 英字以外が来たら仮名モードに戻して読み直す
      capitalNext = false;
    }

    // ---- 仮名モード ----
    if (mask === SIGN.NUMBER) {
      flushUnknownPrefix();
      mode = "num";
      perCell.push({ mask, label: "数" });
      continue;
    }
    if (mask === SIGN.GAIJI) {
      flushUnknownPrefix();
      mode = "latin";
      perCell.push({ mask, label: "外" });
      continue;
    }
    if (PREFIX_LABEL.has(mask) && !KANA.has(mask)) {
      flushUnknownPrefix();
      pendingPrefix = mask;
      perCell.push({ mask, label: PREFIX_LABEL.get(mask) });
      continue;
    }

    const base = KANA.get(mask);
    if (!base) {
      flushUnknownPrefix();
      text += "?";
      perCell.push({ mask, label: "?" });
      continue;
    }

    let out = base;
    if (pendingPrefix) {
      const map =
        pendingPrefix === SIGN.DAKU ? DAKU_MAP :
        pendingPrefix === SIGN.HANDAKU ? HANDAKU_MAP :
        pendingPrefix === SIGN.YOON ? YOON_MAP :
        pendingPrefix === SIGN.YOON_DAKU ? YOON_DAKU_MAP :
        pendingPrefix === SIGN.YOON_HANDAKU ? YOON_HANDAKU_MAP : null;
      out = (map && map.get(base)) || "?" + base;
      pendingPrefix = 0;
    }
    text += out;
    perCell.push({ mask, label: out });
  }
  flushUnknownPrefix();
  return { text: text.trim(), perCell };
}

// ---- エンコード(デモ画像生成用): かな/数字/英字 → マスク列 ----

const KANA_INV = new Map();      // 清音かな → マスク
for (const [mask, ch] of KANA) if (!KANA_INV.has(ch)) KANA_INV.set(ch, mask);

const COMPOSED_INV = new Map();  // 濁音・拗音など → [プレフィックス, 清音マスク]
for (const [base, ch] of DAKU_MAP) COMPOSED_INV.set(ch, [SIGN.DAKU, KANA_INV.get(base)]);
for (const [base, ch] of HANDAKU_MAP) COMPOSED_INV.set(ch, [SIGN.HANDAKU, KANA_INV.get(base)]);
for (const [base, ch] of YOON_MAP) COMPOSED_INV.set(ch, [SIGN.YOON, KANA_INV.get(base)]);
for (const [base, ch] of YOON_DAKU_MAP) COMPOSED_INV.set(ch, [SIGN.YOON_DAKU, KANA_INV.get(base)]);
for (const [base, ch] of YOON_HANDAKU_MAP) COMPOSED_INV.set(ch, [SIGN.YOON_HANDAKU, KANA_INV.get(base)]);

const DIGIT_INV = new Map();
for (const [mask, ch] of DIGITS) DIGIT_INV.set(ch, mask);
const LATIN_INV = new Map();
for (const [mask, ch] of LATIN) LATIN_INV.set(ch, mask);

function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// テキスト → マスク列。行ごとの配列を返す。
function encodeText(input) {
  const lines = [];
  for (const rawLine of input.split("\n")) {
    const line = kataToHira(rawLine);
    const masks = [];
    let mode = "kana";
    let i = 0;
    while (i < line.length) {
      const two = line.slice(i, i + 2);
      const one = line[i];

      if (one === " " || one === "　") {
        masks.push(0); mode = "kana"; i++; continue;
      }
      if (/[0-9]/.test(one)) {
        if (mode !== "num") { masks.push(SIGN.NUMBER); mode = "num"; }
        masks.push(DIGIT_INV.get(one)); i++; continue;
      }
      if (/[a-zA-Z]/.test(one)) {
        if (mode !== "latin") { masks.push(SIGN.GAIJI); mode = "latin"; }
        if (/[A-Z]/.test(one)) masks.push(SIGN.CAPITAL);
        masks.push(LATIN_INV.get(one.toLowerCase())); i++; continue;
      }
      mode = "kana";
      if (COMPOSED_INV.has(two)) {
        masks.push(...COMPOSED_INV.get(two)); i += 2; continue;
      }
      if (COMPOSED_INV.has(one)) {
        masks.push(...COMPOSED_INV.get(one)); i++; continue;
      }
      if (KANA_INV.has(one)) {
        masks.push(KANA_INV.get(one)); i++; continue;
      }
      i++; // 未対応文字はスキップ
    }
    lines.push(masks);
  }
  return lines;
}

window.Braille = { m, SIGN, KANA, DIGITS, LATIN, decodeCells, encodeText };
