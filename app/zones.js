// つらい所（からだの場所）と、つらさの感じ。3D人体図で触れた所を場所に直し、症状の判断に使う言葉と症状の分類に結びつける。
// 座標は 3D人体図（data/body3d.bin）と同じ：単位m、y が上、z が前、+x が体の左側。

// word：判断に使う言い方（「〜が痛い」の「〜」）、cats：symptoms.json の分類
export const ZONES = [
  { id: 'atama_top', name: '頭のてっぺん', word: '頭頂部', cats: ['top', 'headache'] },
  { id: 'hitai', name: '額・頭の前', word: '額', cats: ['frontal', 'headache'] },
  { id: 'koutou', name: '後頭部', word: '後頭部', cats: ['occipital'] },
  { id: 'komekami', name: 'こめかみ・頭の横', word: 'こめかみ', cats: ['temple'] },
  { id: 'me', name: '目', word: '目', cats: ['eyes'] },
  { id: 'hana', name: '鼻', word: '鼻', cats: ['nose'] },
  { id: 'mimi', name: '耳', word: '耳', cats: ['ear'] },
  { id: 'kuchi', name: '口・歯', word: '歯', cats: ['teeth'] },
  { id: 'kao', name: '顔・頬', word: '顔', cats: ['face'] },
  { id: 'nodo', name: 'のど', word: 'のど', cats: ['throat'] },
  { id: 'kubi', name: '首', word: '首', cats: ['neck'] },
  { id: 'kubi_ushiro', name: '首の後ろ', word: '首の後ろ', cats: ['neck', 'occipital'] },
  { id: 'kata', name: '肩', word: '肩', cats: ['katakori'] },
  { id: 'mune', name: '胸', word: '胸', cats: ['lungs', 'heart'] },
  { id: 'waki', name: '脇・脇腹', word: '脇腹', cats: ['ribs'] },
  { id: 'mizoochi', name: 'みぞおち・胃', word: '胃', cats: ['stomach', 'diaphragm'] },
  { id: 'migi_hara', name: '右の脇腹（肝臓のあたり）', word: '右脇腹', cats: ['liver'] },
  { id: 'onaka', name: 'おなか', word: 'おなか', cats: ['abdomen'] },
  { id: 'shitabara', name: '下腹', word: '下腹', cats: ['urinary'] },
  { id: 'sokei', name: '足の付け根（鼠蹊部）', word: '足の付け根', cats: ['anus'] },
  { id: 'senaka', name: '背中', word: '背中', cats: [] },
  { id: 'senaka_shita', name: '背中の下（腎臓のあたり）', word: '腰', cats: ['lowback'] },
  { id: 'koshi', name: '腰', word: '腰', cats: ['lowback'] },
  { id: 'oshiri', name: 'お尻', word: 'お尻', cats: ['anus'] },
  { id: 'ude', name: '腕', word: '腕', cats: ['hands'] },
  { id: 'hiji', name: '肘', word: '肘', cats: ['hands'] },
  { id: 'te', name: '手・手首・指', word: '手', cats: ['hands'] },
  { id: 'futomomo', name: '太もも', word: '太もも', cats: ['legs'] },
  { id: 'hiza', name: '膝', word: '膝', cats: ['legs'] },
  { id: 'sune', name: 'すね', word: 'すね', cats: ['legs'] },
  { id: 'fukurahagi', name: 'ふくらはぎ', word: 'ふくらはぎ', cats: ['legs'] },
  { id: 'ashikubi', name: '足首', word: '足首', cats: ['legs'] },
  { id: 'ashi', name: '足・足の裏', word: '足の裏', cats: ['legs'] },
  { id: 'zenshin', name: '全身', word: '全身', cats: ['fatigue'] },
];
export const zoneById = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// 図を使わずに選べる、大まかな場所
export const QUICK_ZONES = ['hitai', 'koutou', 'me', 'kubi', 'kata', 'senaka', 'koshi', 'mune', 'mizoochi', 'onaka', 'te', 'hiza', 'ashi', 'zenshin'];

// つらさの感じ。form は「〜が◯◯」の言い方、place:false は場所が無くても判断できるもの
export const SENSATIONS = [
  { id: 'itai', name: '痛い', form: '痛い' },
  { id: 'omoi', name: '重い', form: '重い' },
  { id: 'darui', name: 'だるい', form: 'だるい' },
  { id: 'kori', name: 'こる・張る', form: '張る' },
  { id: 'kayui', name: 'かゆい', form: 'かゆい' },
  { id: 'shibire', name: 'しびれる', form: 'しびれる' },
  { id: 'atsui', name: '熱い・ほてる', form: '熱い' },
  { id: 'hie', name: '冷える', form: '冷える' },
  { id: 'mukumi', name: 'むくむ', form: 'むくむ' },
  { id: 'netsu', name: '熱っぽい', text: '熱っぽい', place: false },
  { id: 'nemure', name: '眠れない', text: '眠れない', place: false },
  { id: 'kibun', name: '気分が晴れない', text: '気分がふさぐ', place: false },
];

// 場所の無い訴えに「どのあたりですか？」と問い返すための言葉
const SENSE_WORDS = ['痛', 'いた', '痒', 'かゆ', 'カユ', '重', 'おも', 'だる', 'ダル', 'しびれ', '痺', 'シビレ', '張', 'こる', '凝', 'こり', 'ほて', '冷え', 'むく', 'うず', 'ずきずき', 'ズキズキ', 'つらい', '辛い'];
const BODY_WORDS = ['頭', 'あたま', '額', 'おでこ', 'こめかみ', '顔', '目', '眼', '鼻', '耳', '口', '歯', '喉', 'のど', '首', 'くび', '頸', '頚', '肩', 'かた', '背', 'せなか', '腰', 'こし', '胸', 'むね', '脇', 'わき', '腹', 'おなか', 'みぞおち', '胃', '腸', '尻', 'しり', '腕', 'うで', '肘', 'ひじ', '手', '指', '足', '脚', 'あし', '膝', 'ひざ', 'すね', 'ふくらはぎ', 'もも', 'かかと', '踵', '全身', '体', 'からだ', '身体', '肝', '腎', '肺', '心臓', '股', '陰部', '生理', '肛門', '痔', '皮膚', '肌'];

export function needsPlace(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  return SENSE_WORDS.some((w) => t.includes(w)) && !BODY_WORDS.some((w) => t.includes(w));
}

// 場所と感じから、判断に使う文を作る（例：「膝がしびれる」）
export function phrasesFor(zoneIds, senseIds) {
  const zones = zoneIds.map((id) => zoneById[id]).filter(Boolean);
  const senses = senseIds.map((id) => SENSATIONS.find((s) => s.id === id)).filter(Boolean);
  const out = [];
  const placeSenses = senses.filter((s) => s.place !== false);
  for (const z of zones) {
    if (!placeSenses.length) out.push(`${z.word}がつらい`);
    for (const s of placeSenses) out.push(`${z.word}が${s.form}`);
  }
  if (!zones.length) for (const s of placeSenses) out.push(s.form);
  for (const s of senses.filter((x) => x.place === false)) out.push(s.text);
  return out;
}

export function catsFor(zoneIds) {
  return [...new Set(zoneIds.flatMap((id) => zoneById[id]?.cats || []))];
}

// ---- 3D の点 → 場所 ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
// 腕（肩の付け根→肘→手首→手）。tools/build_body.mjs の形に合わせる
function onArm(p) {
  const s = p[0] >= 0 ? 1 : -1;
  const sh = [0.2 * s, 1.35, -0.006], el = [0.25 * s, 1.08, -0.012], wr = [0.288 * s, 0.84, 0.01], hd = [0.3 * s, 0.75, 0.014];
  return segDist(p, sh, el) < 0.058 || segDist(p, el, wr) < 0.046 || segDist(p, wr, hd) < 0.05;
}

export function zoneOf(pt) {
  const p = [pt.x, pt.y, pt.z];
  const [x, y, z] = p;
  const ax = Math.abs(x);
  // 腕・手
  if (y < 1.33 && y > 0.68 && ax > 0.15 && onArm(p)) {
    if (y >= 1.13) return 'ude';
    if (y >= 1.02) return 'hiji';
    if (y >= 0.87) return 'ude';
    return 'te';
  }
  // あご・耳の下
  if (y >= 1.5 && y < 1.555 && z > 0.03) return z > 0.075 && ax < 0.03 ? 'kuchi' : 'nodo';
  if (y >= 1.53 && y < 1.585 && ax > 0.05 && z < 0.03 && z > -0.035) return 'kubi';
  // 頭
  if (y >= 1.555) {
    if (ax > 0.066 && y > 1.565 && y < 1.64 && z > -0.035 && z < 0.03) return 'mimi';
    if (z > 0.045) {
      if (y >= 1.66) return 'hitai';
      if (y >= 1.612) return ax < 0.016 ? 'hana' : 'me';
      if (y >= 1.583) return ax < 0.02 ? 'hana' : 'kao';
      return 'kuchi';
    }
    if (y >= 1.712) return 'atama_top';
    if (z < -0.035) return y < 1.585 ? 'kubi_ushiro' : 'koutou';
    if (ax > 0.045) return y < 1.58 ? 'kao' : 'komekami';
    return y >= 1.66 ? 'hitai' : 'kao';
  }
  // 首・肩
  if (y >= 1.43) {
    if (ax > 0.07) return 'kata';
    if (z > 0.015) return 'nodo';
    if (z < -0.02) return 'kubi_ushiro';
    return 'kubi';
  }
  if (y >= 1.33 && (ax > 0.12 || (z > 0.04 && ax > 0.05))) return 'kata';
  // 脚
  if (y < 0.82) {
    if (y >= 0.56) return 'futomomo';
    if (y >= 0.41) return 'hiza';
    if (y >= 0.11) {
      const axisZ = -0.004 - (0.008 * (0.5 - y)) / 0.4;
      return z < axisZ - 0.005 ? 'fukurahagi' : 'sune';
    }
    if (y >= 0.065) return 'ashikubi';
    return 'ashi';
  }
  // 骨盤のあたり
  if (y < 0.97) {
    if (z < -0.03) return y < 0.94 ? 'oshiri' : 'koshi';
    if (z > 0.03) return ax > 0.045 && y < 0.905 ? 'sokei' : 'shitabara';
    return 'koshi';
  }
  // 胴
  if (z < -0.035) {
    if (y >= 1.13) return 'senaka';
    if (y >= 1.0 && ax < 0.11) return 'senaka_shita';
    return 'koshi';
  }
  if (ax > 0.11 && z < 0.05) return 'waki';
  if (y >= 1.17) return 'mune';
  if (y >= 1.1) {
    if (ax < 0.035) return 'mizoochi';
    return x < 0 ? 'migi_hara' : 'mizoochi';
  }
  if (y >= 1.0) return 'onaka';
  return 'shitabara';
}
