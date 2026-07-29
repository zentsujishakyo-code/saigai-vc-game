/* ============================================================
   災害VC運営シミュレーター  ゲーム本体
   （内容の調整は config.js のほうで行ってください）
   ============================================================ */

/* ---------- 状態 ---------- */
const S = {
  roster: [],        // 名簿アプリのレコード
  needs: [],         // ニーズ管理アプリのレコード
  vols: [],          // 当日受付アプリのレコード
  reports: [],       // 活動報告アプリのレコード
  review: [],        // ふりかえり項目
  step: 0,           // 進行度（プログレスバー用）
  totalSteps: 12
};

/* ---------- 小道具 ---------- */
const app = () => document.getElementById('app');
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm = t => String(t || '').replace(/[\s　]/g, '');

/* 1日の流れ。いまどこにいるかを、つねに画面上部に出します */
const FLOW = ['①ニーズ受付', '②現地調査', '③当日受付', '④オリエン・マッチング',
              '⑤送り出し', '⑥活動', '⑦活動報告', '⑧ふりかえり'];
function stepOf(phase) {
  if (/ふりかえり|本日終了/.test(phase)) return 7;
  if (/活動報告|活動後/.test(phase))     return 6;
  if (/午後|帰着/.test(phase))           return 5;
  if (/資機材|送り出/.test(phase))       return 4;
  if (/オリエン|マッチング/.test(phase)) return 3;
  if (/当日受付/.test(phase))            return 2;
  if (/現地調査/.test(phase))            return 1;
  if (/ニーズ受付/.test(phase))          return 0;
  return -1;
}
function setTop(time, phase, team) {
  $('#clock').textContent = time;
  $('#phase').textContent = phase;
  $('#team').textContent  = team;
  const strip = document.getElementById('flowstrip');
  if (!strip) return;
  const cur = stepOf(phase);
  if (cur < 0) { strip.className = ''; strip.innerHTML = ''; return; }
  strip.className = 'on';
  strip.innerHTML = FLOW.map((f, i) =>
    '<span class="' + (i === cur ? 'now' : i < cur ? 'done' : '') + '">' + f + '</span>').join('');
}
function bump() {
  S.step++;
  $('#progressbar').style.width = Math.min(100, S.step / S.totalSteps * 100) + '%';
}
function show(html) {
  closeSheet();                       // 前の画面で開いていた受付シートは閉じる
  clearFinger();
  app().innerHTML = '<div class="fade">' + html + '</div>';
  window.scrollTo(0, 0);
  setTimeout(autoPoint, 60);
}
function navi(text) {
  return '<div class="navi"><div class="face">' + sil('staff') + '</div><div class="say">' + text + '</div></div>';
}
/* 電話・来訪の場面に、話し手のシルエットを重ねる */
function pSil(key) { return '<div class="psil">' + sil(key) + '</div>'; }
/* ふりかえり項目を記録する。同じ見出しは上書き（やり直しても二重に増えない） */
function mark(ok, title, detail) {
  const i = S.review.findIndex(r => r.title === title);
  const row = { ok: ok, title: title, detail: detail };
  if (i >= 0) S.review[i] = row; else S.review.push(row);
}

/* 選択肢の見た目切り替え（全画面共通） */
document.addEventListener('click', e => {
  const o = e.target.closest('.opt');
  if (!o) return;
  const box = o.parentElement;
  if (box.dataset.multi === '1') {
    o.classList.toggle('on');
  } else {
    $$('.opt', box).forEach(c => c.classList.remove('on'));
    o.classList.add('on');
  }
  const f = box.closest('.fld');
  if (f) f.classList.remove('err');
});

/* 選択されている値を配列で返す */
function picked(id) { return $$('#' + id + ' .opt.on').map(o => o.dataset.v); }
function pick1(id)  { const a = picked(id); return a.length ? a[0] : ''; }

/* ============================================================
   kintoneへの入力を「見せる」しくみ
   ------------------------------------------------------------
   プレイヤーに文字を打たせず、1項目ずつ順番に入っていく様子を
   見せます。どの欄が「どこから来た値なのか」も一緒に出します。
     📄 受付シート … 紙から書き写した
     💻 名簿 / 当日受付 … 別のアプリから自動で入った
     🔍 現地調査 … 現場で確認した
     ⚙ 自動 … システムが自動で入れた
   ============================================================ */
let AF = null;

function afSrcTag(src) {
  const m = { sheet: '📄 受付シート', roster: '💻 名簿アプリ', recept: '💻 当日受付', field: '🔍 現地で確認', talk: '🗣 口頭の報告', auto: '⚙ 自動' };
  return '<span class="af-src s-' + (src || 'auto') + '">' + (m[src] || m.auto) + '</span>';
}

/* 入力の様子を出す枠と、開始ボタン */
function afPanel(startLabel) {
  return '<div class="af">' +
    '<div class="af-head">💻 kintoneに入力される内容</div>' +
    '<div class="af-log" id="aflog"><p class="muted" style="margin:0">' +
      '下のボタンを押すと、1項目ずつ入力されていく様子が見られます。</p></div>' +
    '<button class="btn btn-lg" id="afStart" style="margin-top:10px">' + esc(startLabel) + '</button>' +
    '</div>';
}

function afRun(steps, doneMsg, doneLabel, doneFn) {
  AF = { steps: steps, i: 0, doneMsg: doneMsg, doneLabel: doneLabel, doneFn: doneFn };
  const b = $('#afStart');
  if (b) { b.disabled = true; b.textContent = '入力中…'; }
  $('#aflog').innerHTML = '';
  clearFinger();
  afNext();
}

function afNext() {
  if (!AF) return;
  afClearCallout();
  clearFinger();            // 入力中は指を消す（前の吹き出しの指が残らないように）
  if (AF.i >= AF.steps.length) return afFinish();
  const s = AF.steps[AF.i++];
  const el  = s.sel ? $(s.sel) : null;
  const fld = el ? el.closest('.fld') : null;
  AF.cur = { s: s, fld: fld };

  // 記録として残すログ（あとから見返せるように、見出しだけ）
  $('#aflog').insertAdjacentHTML('beforeend',
    '<div class="af-line fade">' + afSrcTag(s.src) + '<b>' + esc(s.label) + '</b></div>');
  const log = $('#aflog'); if (log) log.scrollTop = log.scrollHeight;
  if (fld) { fld.classList.add('filling'); fld.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  const after = () => {
    if (s.say) return afCallout(s, fld);         // 理由を読んでもらって、次へ
    if (fld) setTimeout(() => fld.classList.remove('filling'), 350);
    setTimeout(afNext, s.pause || 700);          // 説明のない項目だけ自動で進む
  };

  if (s.run) {
    s.run();                                     // 写真の撮影など、値の入力以外の動き
    setTimeout(after, 450);
  } else if (s.type === 'opt') {
    (s.values || [s.value]).forEach(v => {
      const o = document.querySelector(s.sel + ' .opt[data-v="' + v + '"]');
      if (o) o.click();
    });
    setTimeout(after, 350);
  } else if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    typeInto(el, String(s.value == null ? '' : s.value), after);
  } else {
    setTimeout(after, 350);                      // 説明だけのステップ
  }
}

/* 入力した欄のすぐ下に、なぜそう入力したのかを出します。
   プレイヤーが「次へ」を押すまで止まります。 */
function afCallout(s, fld) {
  const html =
    '<div class="callout fade" id="afco">' +
      '<div class="co-top">' + afSrcTag(s.src) +
        '<b>' + esc(s.label) + '</b>' +
        '<span class="co-n">' + AF.i + ' / ' + AF.steps.length + '</span></div>' +
      '<div class="co-say">' + s.say + '</div>' +
      '<button class="btn co-next" onclick="afNext()">' +
        (AF.i >= AF.steps.length ? '入力を終える' : '次へ') + '</button>' +
    '</div>';
  if (fld) fld.insertAdjacentHTML('beforeend', html);
  else $('#aflog').insertAdjacentHTML('beforeend', html);
  const co = $('#afco');
  if (co) co.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(autoPoint, 300);
}
/* すべて入力し終わったとき。次へ進むボタンを出して、そこまでスクロールします */
function afFinish() {
  const a = AF; AF = null;
  const log = $('#aflog');
  if (log) {
    log.insertAdjacentHTML('beforeend', '<div class="af-done fade">✓ ' + a.doneMsg + '</div>');
    log.scrollTop = log.scrollHeight;
  }
  const b = $('#afStart');
  if (b) {
    b.disabled = false;
    b.textContent = a.doneLabel;
    b.onclick = a.doneFn;
    b.scrollIntoView({ behavior: 'smooth', block: 'center' });   // ボタンを画面に出す
  }
  setTimeout(autoPoint, 800);
}

function afClearCallout() {
  const co = document.getElementById('afco');
  if (co) co.remove();
  if (AF && AF.cur && AF.cur.fld) AF.cur.fld.classList.remove('filling');
}

/* 1文字ずつ入っていくように見せる */
function typeInto(el, text, done) {
  el.value = '';
  let i = 0;
  // 短い欄はゆっくり、長い文章は少し速く。全体の速さは config.js の TYPE_SPEED で変えられます
  const base = CONFIG.TYPE_SPEED || 1;
  const sp = Math.max(16, Math.min(55, 2400 / Math.max(1, text.length))) * base;
  const t = setInterval(() => {
    i += 1;
    el.value = text.slice(0, i);
    el.scrollTop = el.scrollHeight;
    if (i >= text.length) { clearInterval(t); el.value = text; if (done) setTimeout(done, 250); }
  }, sp);
}

/* ============================================================
   紙からkintoneへの「書き写し」
   ------------------------------------------------------------
   本番のkintoneでは、この欄は自分で文章を入力します。
   ここでは流れをつかむことを優先して、ボタンひとつで書き写せる
   ようにしています。押すと、気をつけることを説明したうえで、
   1文字ずつ入力される様子を見せます。
   ============================================================ */
/* ===== 押すべきボタンを指し示す ===== */
function clearFinger() {
  const f = document.getElementById('finger');
  if (f) f.remove();
}
function pointAt(el) {
  clearFinger();
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0) return;
  const d = document.createElement('div');
  d.id = 'finger'; d.className = 'finger'; d.textContent = '👆';
  d.style.left = (r.right + window.scrollX - 16) + 'px';
  d.style.top  = (r.bottom + window.scrollY - 8) + 'px';
  document.body.appendChild(d);
}
/* いま押すべきものを、上から順に探します */
/* 指を出すのは「次に進むための1つのボタン」だけ。
   選択肢（聞き取りの質問・3択の設問・マッチングの割り当て）は
   プレイヤーが自分で考えて選ぶところなので、指は出しません。 */
function autoPoint() {
  if (document.querySelector('.mask') || document.querySelector('.sheetov')) return clearFinger();
  if (document.querySelector('.qbtn')) return clearFinger();      // 聞き取り中は出さない
  if (document.querySelectorAll('.panel .btn-gray.btn-lg').length >= 2) return clearFinger(); // 3択の設問
  const el =
    $('.co-next') ||
    $$('#afStart').find(b => !b.disabled) ||
    $$('.btn-lg').find(b => !b.disabled && !b.classList.contains('btn-gray')) ||
    $('.actbtn') ||
    $$('.panel .btn').find(b => !b.disabled);
  pointAt(el);
}

/* 選択肢のHTML */
function optsHtml(id, list, multi) {
  return '<div class="opts" id="' + id + '" data-multi="' + (multi ? 1 : 0) + '">' +
    list.map(v => '<div class="opt" data-v="' + esc(v) + '">' + esc(v) + '</div>').join('') + '</div>';
}

/* 入力エラー表示 */
function fail(fldId, msg) {
  const f = $('#' + fldId);
  if (!f) return;
  f.classList.add('err');
  const m = $('.errmsg', f);
  if (m) m.textContent = msg;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearFails() { $$('.fld.err').forEach(f => f.classList.remove('err')); }

/* モーダル */
function modal(html) {
  clearFinger();
  document.getElementById('modalroot').innerHTML =
    '<div class="mask"><div class="modal fade">' + html + '</div></div>';
}
function closeModal() {
  document.getElementById('modalroot').innerHTML = '';
  setTimeout(autoPoint, 60);
}
function closeSheet() {
  const r = document.getElementById('sheetroot');
  if (r) r.innerHTML = '';
}

/* kintone風の枠 */
function kin(appKey, inner, opts) {
  opts = opts || {};
  const a = CONFIG.APPS.find(x => x.key === appKey) || { icon: '', name: '' };
  return '<div class="kin">' +
    '<div class="kin-head">' +
      '<div class="ic" style="white-space:pre-line">' + esc(a.icon) + '</div>' +
      '<div class="nm">' + esc(a.name) + '</div>' +
      (opts.plus ? '<div class="plus">＋</div>' : '') +
    '</div>' +
    (opts.actions ? '<div class="actbar">' + opts.actions + '</div>' : '') +
    '<div class="kin-body">' + inner + '</div>' +
    (opts.foot ? '<div class="kin-foot">' + opts.foot + '</div>' : '') +
  '</div>';
}

/* ============================================================
   ドット絵の欧文フォント（5×7）
   ------------------------------------------------------------
   タイトルの英字を、四角を並べて描きます。
   漢字はドット絵にすると読みにくくなるため、欧文だけに使います。
   ============================================================ */
const PIXFONT = {
  A:['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
  B:['####.','#...#','#...#','####.','#...#','#...#','####.'],
  C:['.###.','#...#','#....','#....','#....','#...#','.###.'],
  D:['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  E:['#####','#....','#....','####.','#....','#....','#####'],
  F:['#####','#....','#....','####.','#....','#....','#....'],
  G:['.###.','#...#','#....','#.###','#...#','#...#','.###.'],
  H:['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  I:['#####','..#..','..#..','..#..','..#..','..#..','#####'],
  J:['..###','...#.','...#.','...#.','...#.','#..#.','.##..'],
  K:['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
  L:['#....','#....','#....','#....','#....','#....','#####'],
  M:['#...#','##.##','#.#.#','#...#','#...#','#...#','#...#'],
  N:['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
  O:['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
  P:['####.','#...#','#...#','####.','#....','#....','#....'],
  Q:['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
  R:['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
  S:['.####','#....','#....','.###.','....#','....#','####.'],
  T:['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  U:['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
  V:['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
  W:['#...#','#...#','#...#','#...#','#.#.#','##.##','#...#'],
  X:['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
  Y:['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
  Z:['#####','....#','...#.','..#..','.#...','#....','#####'],
  '0':['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],
  '1':['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
  '2':['.###.','#...#','....#','...#.','..#..','.#...','#####'],
  '3':['#####','...#.','..#..','...#.','....#','#...#','.###.'],
  '4':['...#.','..##.','.#.#.','#..#.','#####','...#.','...#.'],
  '5':['#####','#....','####.','....#','....#','#...#','.###.'],
  '6':['..##.','.#...','#....','####.','#...#','#...#','.###.'],
  '7':['#####','....#','...#.','..#..','.#...','.#...','.#...'],
  '8':['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],
  '9':['.###.','#...#','#...#','.####','....#','...#.','.##..'],
  '-':['.....','.....','.....','#####','.....','.....','.....']
};

/* 文字列をドット絵のSVGにする */
function pixText(text, px) {
  px = px || 5;
  const chars = String(text).toUpperCase().split('');
  let x = 0, rects = '';
  chars.forEach(ch => {
    const g = PIXFONT[ch];
    if (g) {
      g.forEach((row, y) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] === '#') {
            rects += '<rect x="' + ((x + i) * px) + '" y="' + (y * px) + '" width="' + px + '" height="' + px + '"/>';
          }
        }
      });
    }
    x += 6;                       // 5ドット＋字間1ドット
  });
  const w = (x - 1) * px, h = 7 * px;
  return '<svg class="pixtitle" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + rects + '</svg>';
}

/* ============================================================
   人物のシルエット
   ------------------------------------------------------------
   顔は描きません。誰か特定の人ではなく「そういう立場の人」として
   見えるように、輪郭だけで表します。
   ============================================================ */
/* 頭・首・肩は共通の部品にして、髪や帽子だけを足し引きします */
const SIL_HEAD  = '<circle cx="50" cy="31" r="18"/>';
const SIL_BUST  = '<path d="M42 46 h16 v13 q23 4 27 19 l3 22 h-76 l3-22 q4-15 27-19z"/>';
const SIL_BUST_S= '<path d="M43 47 h14 v12 q20 4 24 18 l3 23 h-68 l3-23 q4-14 24-18z"/>';

const SIL = {
  /* 高齢の女性（髪をまとめている） */
  elderF: SIL_BUST + SIL_HEAD + '<circle cx="50" cy="12" r="8.5"/>',
  /* 中年の男性（短髪） */
  manM:   SIL_BUST + SIL_HEAD + '<path d="M32 24 q2-15 18-15 q16 0 18 15 q-6-8-18-8 q-12 0-18 8z"/>',
  /* 高齢の男性（肩がやや小さい） */
  elderM: SIL_BUST_S + SIL_HEAD,
  /* 職員（ビブス着用） */
  staff:  SIL_BUST + SIL_HEAD +
          '<path d="M40 78 h20 v22 h-20z" fill="#fff" opacity=".4"/>',
  /* ボランティア（帽子） */
  volun:  SIL_BUST + SIL_HEAD +
          '<path d="M32 25 q1-16 18-16 q17 0 18 16z"/><rect x="25" y="23" width="50" height="5.5" rx="2.7"/>'
};
function sil(key, cls) {
  return '<svg class="sil ' + (cls || '') + '" viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">' +
    (SIL[key] || SIL.staff) + '</svg>';
}
/* 複数人（オリエンテーションや帰着の場面で使います） */
function silGroup() {
  return '<div class="silrow">' + sil('volun') + sil('manM') + sil('elderF') + sil('volun') + sil('elderM') + '</div>';
}

/* 現地写真のかわりのイラスト */
const SCENES = {
  mud: '<svg class="svgbox" viewBox="0 0 320 190"><rect width="320" height="190" fill="#dfe8ec"/>' +
       '<rect x="40" y="55" width="240" height="95" fill="#f3efe6" stroke="#b9ad97"/>' +
       '<polygon points="30,58 160,15 290,58" fill="#9c7d63"/>' +
       '<rect x="120" y="95" width="60" height="55" fill="#6f5b47"/>' +
       '<rect x="60" y="80" width="42" height="32" fill="#cfe3ee" stroke="#8fa8b5"/>' +
       '<rect x="200" y="80" width="42" height="32" fill="#cfe3ee" stroke="#8fa8b5"/>' +
       '<path d="M40 150 Q90 132 140 146 Q200 160 280 140 L280 150 Z" fill="#8b6c4d"/>' +
       '<rect x="40" y="128" width="240" height="22" fill="#8b6c4d" opacity=".85"/>' +
       '<rect x="0" y="150" width="320" height="40" fill="#7d6247"/>' +
       '<text x="160" y="178" font-size="12" fill="#fff" text-anchor="middle">床上まで泥が入っている</text></svg>',
  boxes: '<svg class="svgbox" viewBox="0 0 320 190"><rect width="320" height="190" fill="#dfe8ec"/>' +
       '<rect x="30" y="40" width="260" height="112" fill="#e8e2d5" stroke="#b9ad97"/>' +
       '<rect x="30" y="30" width="260" height="14" fill="#a9a093"/>' +
       '<rect x="55" y="95" width="52" height="45" fill="#c9a06a" stroke="#96703f"/>' +
       '<rect x="112" y="105" width="46" height="35" fill="#c9a06a" stroke="#96703f"/>' +
       '<rect x="165" y="92" width="55" height="48" fill="#bb8f57" stroke="#96703f"/>' +
       '<rect x="225" y="108" width="42" height="32" fill="#c9a06a" stroke="#96703f"/>' +
       '<rect x="30" y="133" width="260" height="19" fill="#7fa3b5" opacity=".55"/>' +
       '<rect x="0" y="152" width="320" height="38" fill="#8d9aa0"/>' +
       '<text x="160" y="178" font-size="12" fill="#fff" text-anchor="middle">物置の荷物が濡れている</text></svg>'
};

/* ============================================================
   1. タイトル
   ============================================================ */
function sceneTitle() {
  setTop('--:--', '　', 'スタート');
  $('#progressbar').style.width = '0%';
  show(
    '<div class="titlecard">' +
      pixText('SAIGAI VC', 6) +
      '<h1 class="tmain">災害VC運営シミュレーター</h1>' +
      '<p class="tsub">' + esc(CONFIG.CENTER) + '　訓練用</p>' +
    '</div>' +
    '<div class="panel">' +
      '<p>災害ボランティアセンターの1日を、ひとりで体験できるゲームです。' +
      'kintoneによく似た画面で、実際に入力しながら流れをつかみます。</p>' +
      '<p class="muted">所要 約20分／パソコン・スマホどちらでも／' +
      '<b>本番のkintoneには一切つながっていません。</b>登場する氏名・住所・電話番号はすべて架空のものです。</p>' +
      '<button class="btn btn-lg" style="margin-top:16px" onclick="sceneIntro(0)">はじめる</button>' +
      '<p class="muted center" style="margin:12px 0 0;font-size:.88rem">' +
        esc(CONFIG.DISASTER) + '／' + esc(CONFIG.DAY) + '</p>' +
    '</div>'
  );
}

/* ============================================================
   2. はじめの説明
   ============================================================ */
function sceneIntro(i) {
  if (i >= CONFIG.INTRO.length) { bump(); return scenePortal(); }
  const s = CONFIG.INTRO[i];
  setTop(CONFIG.TIMES.intro, '開設準備', 'オリエンテーション');
  show(
    '<div class="panel">' +
      (i === 1 ? silGroup() : '') +
      '<h2>' + esc(s.title) + '</h2>' +
      '<p>' + s.body + '</p>' +
      '<div class="btnrow end">' +
        (i > 0 ? '<button class="btn-gray" onclick="sceneIntro(' + (i - 1) + ')">もどる</button>' : '') +
        '<button class="btn" onclick="sceneIntro(' + (i + 1) + ')">' + (i === CONFIG.INTRO.length - 1 ? '災害VCを開設する' : '次へ') + '</button>' +
      '</div>' +
      '<p class="muted center" style="margin-top:10px">' +
        '<a href="#" onclick="event.preventDefault();bump();bump();sceneCall(0)">説明とアプリの確認をとばして、すぐ始める</a>　' +
        (i + 1) + ' / ' + CONFIG.INTRO.length + '</p>' +
    '</div>'
  );
}

/* ============================================================
   3. ポータル（6アプリの確認）
   ============================================================ */
function scenePortal() {
  setTop(CONFIG.TIMES.portal, '開設準備', '全班');
  show(
    navi('災害VCを開設しました。使うのは<b>6つのアプリ</b>です。<br>' +
         'いま覚えなくてかまいません。<b>「こういうものがある」</b>とだけ見ておいてください。') +
    '<div class="panel">' +
      CONFIG.APPS.map(a =>
        '<div class="applist">' +
          '<div class="ic">' + esc(a.icon) + '</div>' +
          '<div class="tx"><b>' + esc(a.name) + '</b><div class="ds">' + a.desc + '</div></div>' +
        '</div>').join('') +
      '<button class="btn btn-lg" style="margin-top:16px" onclick="bump();sceneCall(0)">' +
      'ニーズ班の仕事へ進む</button>' +
    '</div>'
  );
}

/* ============================================================
   4. ニーズ班（電話を受けて登録する）
   ============================================================ */
function sceneCall(idx) {
  if (idx >= CONFIG.CALLS.length) { bump(); return sceneSurveyIntro(); }
  const c = CONFIG.CALLS[idx];
  setTop(CONFIG.TIMES.needs, 'ニーズ受付', 'ニーズ班');
  show(
    navi('<b>ニーズ班</b>の仕事です。電話・窓口・訪問で受けた困りごとを、<b>ニーズ管理アプリ</b>に登録します。<br>まずは相手の話をよく聞いてください。') +
    '<div class="phone">' + pSil(c.sil) +
      '<div class="ring">' + esc(c.ring) + '</div>' +
      '<div id="lines"></div>' +
      '<div class="who">' + esc(c.who) + '</div>' +
    '</div>' +
    '<div id="afterCall"></div>'
  );
  // セリフを1行ずつ表示
  let n = 0;
  const tick = setInterval(() => {
    if (n >= c.lines.length) {
      clearInterval(tick);
      $('#afterCall').innerHTML =
        '<button class="btn btn-lg" onclick="sceneIntake(' + idx + ')">話を聞く（聞き取りを始める）</button>';
      return;
    }
    $('#lines').insertAdjacentHTML('beforeend', '<p class="line fade">「' + esc(c.lines[n]) + '」</p>');
    n++;
  }, 950);
}

/* ============================================================
   4-2. 聞き取り（ニーズ受付シート）
   ------------------------------------------------------------
   プレイヤーは「何を聞くか」を選ぶ。書き取るのはシート側（自動）。
   聞かなかった項目は空欄のまま残る。
   ============================================================ */
function sceneIntake(idx) {
  const c = CONFIG.CALLS[idx];
  S.curCall = idx;
  S.sheet = { fields: {}, memo: [], asked: [], ended: false, judge: {} };
  setTop(CONFIG.TIMES.needs, 'ニーズ受付（聞き取り）', 'ニーズ班');
  show(
    navi('電話はつながったままです。<b>何を聞くか</b>を選んでください。<br>' +
         '聞いた内容は、右の<b>ニーズ受付シート</b>に書き取られます。' +
         '<span class="muted">聞かなかったことは空欄のまま残ります。</span>') +
    '<div class="split">' +
      '<div class="sheetcol" id="sheetcol"></div>' +
      '<div class="formcol">' +
        '<div class="phone">' + pSil(c.sil) +
          '<div class="ring">☎ 通話中　' + esc(c.requester) + 'さん</div>' +
          '<div id="talk"><p class="line">「' + esc(c.lines[c.lines.length - 1]) + '」</p></div></div>' +
        '<div class="panel" id="qpanel"></div>' +
      '</div>' +
    '</div>' + sheetFab()
  );
  drawIntake(idx);
}

function drawIntake(idx, writeKeys) {
  const c = CONFIG.CALLS[idx];
  const left = c.askBudget - S.sheet.asked.length;
  paintSheet(c, writeKeys);
  if (S.sheet.ended) return;
  $('#qpanel').innerHTML =
    '<div class="qbudget">聞ける回数　のこり <b>' + left + '</b> 回' +
      '<span class="muted">　／ 相手はご高齢です。長電話は負担になります。</span></div>' +
    c.questions.map((q, i) =>
      '<button class="qbtn' + (S.sheet.asked.indexOf(i) >= 0 ? ' asked' : '') + '"' +
        (S.sheet.asked.indexOf(i) >= 0 ? ' disabled' : ' onclick="ask(' + idx + ',' + i + ')"') + '>' +
        '「' + esc(q.q) + '」</button>').join('') +
    '<button class="btn-gray btn-lg" style="margin-top:10px" onclick="endIntake(' + idx + ')">聞き取りを終える</button>';
  autoPoint();
}

function ask(idx, qi) {
  const c = CONFIG.CALLS[idx];
  const q = c.questions[qi];
  S.sheet.asked.push(qi);
  $('#talk').insertAdjacentHTML('beforeend',
    '<p class="line fade" style="opacity:.75">（あなた）' + esc(q.q) + '</p>' +
    '<p class="line fade">「' + esc(q.a) + '」</p>');

  if (q.bad) {
    modal('<h3>その質問は控えましょう</h3><p>' + q.bad + '</p>' +
      '<div class="btnrow end"><button class="btn" onclick="closeModal()">わかりました</button></div>');
    S.flags.badAsked = true;   // 一度でも聞いたら、あとの電話では取り消されない
  }
  if (q.set) Object.keys(q.set).forEach(k => { S.sheet.fields[k] = q.set[k]; });
  if (q.memo) S.sheet.memo.push(q.memo);

  // どの欄に書き取られたかを伝える（シートが画面に出ていなくても分かるように）
  let wrote = [], slots = [];
  if (q.set) Object.keys(q.set).forEach(k => {
    slots.push(k);
    const l = SHEET_LABEL[k]; if (l && wrote.indexOf(l) < 0) wrote.push(l);
  });
  if (q.memo) { slots.push('memo'); wrote.push('現地の様子・補足メモ'); }
  if (wrote.length) {
    $('#talk').insertAdjacentHTML('beforeend',
      '<p class="wrote fade">✏️ 受付シートの「' + esc(wrote.join('」「')) + '」に書き取りました</p>');
  }

  if (S.sheet.asked.length >= c.askBudget) {
    S.sheet.tired = true;
    $('#talk').insertAdjacentHTML('beforeend',
      '<p class="line fade" style="color:#ffd9a0">「すみません、少し疲れてしもうて…。またお電話します。」</p>');
    return endIntake(idx, slots);
  }
  drawIntake(idx, slots);
}

function endIntake(idx, writeKeys) {
  const c = CONFIG.CALLS[idx];
  S.sheet.ended = true;
  paintSheet(c, writeKeys);
  $('#qpanel').innerHTML =
    '<h2 style="font-size:1.06rem">受付時の判断</h2>' +
    '<p class="muted">聞き取った内容をもとに、受付シートの下段を記入します。</p>' +
    '<div class="fld"><label>現地調査</label>' + optsHtml('o_jsv', ['必要', '不要', '判断できない（要相談）'], false) + '</div>' +
    '<div class="fld"><label>危機介入の必要性</label>' + optsHtml('o_jcri', ['必要あり'], true) + '</div>' +
    '<div class="fld"><label>完了後見守りを要するニーズ</label>' + optsHtml('o_jwatch', ['要注意'], true) + '</div>' +
    '<button class="btn btn-lg" onclick="saveJudge(' + idx + ')">聞き取り完了　→　kintoneに入力する</button>';
  $('#qpanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(autoPoint, 400);
}

function saveJudge(idx) {
  const c = CONFIG.CALLS[idx];
  S.sheet.judge = {
    survey: pick1('o_jsv'),
    crisis: picked('o_jcri').length > 0,
    watch:  picked('o_jwatch').length > 0
  };

  // 採点：危機介入の判断に必要なことを聞けていたか
  const vitals = c.questions.map((q, i) => q.vital ? i : -1).filter(i => i >= 0);
  if (vitals.length) {
    const got = vitals.filter(i => S.sheet.asked.indexOf(i) >= 0).length;
    const all = got === vitals.length;
    mark(all, '危機介入の判断に必要なことを聞き取れた',
      all ? '一人暮らし・持病・断水・支援者なし。この4つを聞けたので、受付の時点で「危機介入の必要性あり」と判断できます。'
          : '聞けたのは ' + got + ' / ' + vitals.length + ' 項目でした。<b>聞かなかったことは、記録にも残りませんし、判断もできません。</b>' +
            '「どなたと住んでいるか」「お体の具合」「水道は使えるか」「近くに頼れる人はいるか」──この4つが、危機介入の必要性を分ける情報です。');
  }
  // 採点：受付時の判断
  if (c.judge.crisis) {
    // 危機介入が必要な方 … 気づけたかどうかを記録
    const jok = S.sheet.judge.crisis;
    mark(jok, '受付時に、危機介入の必要性を正しく判断した',
      jok ? '受付シートの下段まで記入できました。この判断があるから、現地調査より前に優先度を共有できます。'
          : esc(c.requester) + 'さんは危機介入が必要な状態でした。受付の段階でチェックしておくと、後の班が優先順位をつけられます。' +
            'そして<b>チェックを入れたら、その場で班長・センター長に報告・相談します</b>。' +
            '記録して次の班に回すだけでは、間に合わないことがあります。');
  } else if (S.sheet.judge.crisis) {
    // 必要のない方に付けてしまった場合だけ記録
    mark(false, '危機介入のチェックを、本当に必要な方だけに絞れた',
      esc(c.requester) + 'さんはご家族と同居で、母屋にも被害がありません。ここに危機介入のチェックを付けると、' +
      '本当に急ぐ方が埋もれてしまいます。全部に付けるのは、何も付けないのと同じです。');
  }
  // 採点：名簿にない方は、基本情報を聞けていないと登録できない
  if (!c.inRoster) {
    const needIdx = c.questions.map((q, i) => q.need ? i : -1).filter(i => i >= 0);
    if (needIdx.every(i => S.sheet.asked.indexOf(i) >= 0)) {
      mark(true, '受付の1回の電話で、基本情報を聞き取れた',
        '氏名・電話番号・住所がそろっているので、そのまま名簿に登録できます。' +
        '名簿にない方は、この3つが無いとニーズの登録まで進めません。');
    }
  }
  if (S.flags.badAsked) {
    mark(false, '受付にふさわしい質問を選んだ',
      '費用や謝礼をたずねる質問がありました。災害ボランティアの活動は無償です。こちらから先に「費用はかかりません」と伝えるのが、受付の基本の姿勢です。');
  } else {
    mark(true, '受付にふさわしい質問を選んだ', '相手の負担にならない範囲で、必要なことを聞けました。');
  }

  // 危機介入ありと判断したら、記録より先に報告・相談へ
  if (S.sheet.judge.crisis) return sceneEscalate(idx);
  needsForm(idx);
}

/* ============================================================
   4-3. 報告・相談（危機介入ありと判断したとき）
   ------------------------------------------------------------
   受付の時点で班長・センター長に上げる。一人で抱えない。
   ============================================================ */
function sceneEscalate(idx) {
  const c = CONFIG.CALLS[idx];
  S.curCall = idx;
  setTop(CONFIG.TIMES.needs, 'ニーズ受付（報告・相談）', 'ニーズ班');
  show(
    navi('受付シートの<b>「危機介入の必要性 ☑ 必要あり」</b>にチェックを入れました。<br>' +
         'この判断をしたあと、<b>すぐに何をしますか。</b>') +
    '<div class="split">' +
      '<div class="sheetcol">' + sheetHtml(c) + '</div>' +
      '<div class="formcol">' +
        '<div class="panel" style="background:#fdeceb;border-color:#f3c4c0">' +
          '<p style="margin:0;font-size:1rem">' + esc(c.requester) + 'さんは、' +
          (c.crisisSummary || '危機介入が必要と判断した状態です。') + '</p>' +
        '</div>' +
        '<div class="panel"><h2>どうしますか？</h2>' +
          '<div class="btnrow" style="flex-direction:column">' +
            '<button class="btn-gray btn-lg" onclick="answerEscalate(' + idx + ',1)">① このままニーズ管理アプリに入力し、現地調査班に引き継ぐ</button>' +
            '<button class="btn-gray btn-lg" onclick="answerEscalate(' + idx + ',2)">② 受付シートを持って、ニーズ班の班長とセンター長にすぐ報告・相談する</button>' +
            '<button class="btn-gray btn-lg" onclick="answerEscalate(' + idx + ',3)">③ 現地調査の結果が出てから、まとめて報告する</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' + sheetFab()
  );
}

function answerEscalate(idx, a) {
  const c = CONFIG.CALLS[idx];
  const ok = (a === 2);
  let d;
  if (ok) {
    d = '正解です。<b>危機介入が必要な事例は、記録して次の班に回すだけでは間に合わないことがあります。</b>' +
        '受付の時点で班長・センター長に上げれば、センターとして優先順位を上げる判断ができます。' +
        'また、土砂の撤去だけでは解決しないので、<b>地域包括支援センター・保健師・民生委員など、災害VC以外の支援につなぐ相談</b>もその場でできます。' +
        '判断を一人で抱えないのが、この仕事の原則です。';
  } else if (a === 1) {
    d = '記録は残りますが、<b>誰かがそれを見るまで何も動きません。</b>' +
        '災害時のニーズ管理アプリには、次々とレコードが積み上がります。その中に埋もれれば、優先度は上がりません。' +
        '危機介入ありと判断したなら、その場で班長・センター長に声をかけてください。';
  } else {
    d = '現地調査の結果を待つと、<b>半日から1日遅れます。</b>' +
        '断水で生活が成り立っていない方にとって、その半日は重い。' +
        '受付の時点で報告しておけば、現地調査そのものを早める判断もできます。';
  }
  mark(ok, '危機介入が必要な事例を、受付の時点で班長・センター長に報告した', d);

  // 危機介入までは要らない方を上げた場合は、班長がその場で修正します
  const doubt = (!c.judge.crisis && c.chiefDoubt)
    ? '<div class="panel" style="margin:12px 0 0;background:#f6f8f8">' +
      '<p style="margin:0"><b>班長から</b><br>' + c.chiefDoubt + '</p></div>'
    : '';

  modal('<h3>' + (ok ? '✓ その判断で正解です' : '報告のタイミングを確認しましょう') + '</h3>' +
    '<p>' + d + '</p>' +
    '<p class="muted">受付シートに「危機介入の必要性」の欄があるのは、' +
    '<b>この判断を紙の上で見えるようにして、上に上げるため</b>でもあります。</p>' + doubt +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();needsForm(' + idx + ')">kintoneに入力する</button></div>');
}

/* ============================================================
   受付シートの表示
   ------------------------------------------------------------
   広い画面 … 左に置いて、見ながら入力できます。
   狭い画面 … 上下に並べると見ながら入力できないので、
              右下の「受付シート」ボタンで重ねて開きます。
              紙を手に取って見て、置いて入力する感覚に近づけています。
   ============================================================ */
function sheetFab() {
  return '<button class="sheetfab" id="sheetfab" onclick="openSheet()">📄 受付シート</button>';
}
function openSheet() {
  const c = CONFIG.CALLS[S.curCall] || CONFIG.CALLS[0];
  document.getElementById('sheetroot').innerHTML =
    '<div class="sheetov" onclick="closeSheet()">' +
      '<div class="sheetov-panel" onclick="event.stopPropagation()">' +
        '<div class="sheetov-head"><span>📄 ニーズ受付シート</span>' +
          '<button class="btn btn-sm" onclick="closeSheet()">閉じる</button></div>' +
        '<div class="sheetov-body" id="sheetOverlayBody">' + sheetHtml(c, true) + '</div>' +
      '</div>' +
    '</div>';
}

/* シートに書き込んだら、左の欄も重ね表示も同時に描き直す。
   writeKeys を渡すと、その欄だけ鉛筆で書いているように見せます。 */
function paintSheet(c, writeKeys) {
  const col = $('#sheetcol');           if (col) col.innerHTML = sheetHtml(c);
  const ov  = $('#sheetOverlayBody');   if (ov)  ov.innerHTML  = sheetHtml(c, true);
  const fab = $('#sheetfab');
  if (fab) { fab.classList.remove('ping'); void fab.offsetWidth; fab.classList.add('ping'); }
  if (writeKeys && writeKeys.length) {
    writeKeys.forEach(k => {
      $$('[data-slot="' + k + '"]').forEach(el => {
        el.classList.remove('writing'); void el.offsetWidth; el.classList.add('writing');
      });
    });
  }
}

/* 聞き取った内容が、シートのどの欄に入ったかを伝えます */
const SHEET_LABEL = { name: '氏名', tel: '電話番号', addr: '住所', state: '依頼内容', when: '依頼内容' };

/* 受付シート（紙）の描画 */
function sheetHtml(c, bare) {
  const f = S.sheet.fields, j = S.sheet.judge, ended = S.sheet.ended;
  const row = (k, v, slot) => '<div class="row"><div class="k">' + k + '</div>' +
    '<div class="v ' + (v ? 'filled' : 'blank') + '"' + (slot ? ' data-slot="' + slot + '"' : '') + '>' +
    (v ? '<span class="ink">' + esc(v) + '</span>' : '（未確認）') + '</div></div>';
  const box = (on, label) => '<span class="chk">' + (on ? '☑' : '☐') + ' ' + label + '</span>';

  const inner =
    '<div class="st">災害ボランティアセンター　ニーズ受付シート</div>' +
    '<div class="note">聞き取り後 kintone（ニーズ管理アプリ）に入力してください</div>' +

    '<div class="sec">■ 受付情報</div>' +
    row('受付日時', CONFIG.TIMES.needs + ' 頃') +
    row('担当者', CONFIG.STAFF) +
    '<div class="row"><div class="k">受付方法</div><div class="v filled">' +
      box(true, '電話') + box(false, '窓口') + box(false, '訪問') + '</div></div>' +

    '<div class="sec">■ 依頼者の情報</div>' +
    row('氏名', f.name, 'name') + row('電話番号', f.tel, 'tel') + row('住所', f.addr, 'addr') +

    '<div class="sec">■ 依頼内容</div>' +
    '<div class="free" data-slot="state">' +
      (f.state ? '<span class="ink">' + esc(f.state) + (f.when ? '<br>' + esc(f.when) : '') + '</span>'
               : '<span class="v blank">（未確認）</span>') +
    '</div>' +

    '<div class="sec">■ 現地の様子・補足メモ</div>' +
    '<div class="free" data-slot="memo">' +
      (S.sheet.memo.length
        ? '<span class="ink"><ul>' + S.sheet.memo.map(m => '<li>' + esc(m) + '</li>').join('') + '</ul></span>'
        : '<span class="v blank">（記載なし）</span>') +
    '</div>' +

    '<div class="sec">■ 受付時の判断</div>' +
    '<div class="row"><div class="k">現地調査</div><div class="v">' +
      box(j.survey === '必要', '必要') + box(j.survey === '不要', '不要') +
      box(j.survey === '判断できない（要相談）', '要相談') + '</div></div>' +
    '<div class="row"><div class="k">危機介入</div><div class="v">' + box(j.crisis, '必要あり') + '</div></div>' +
    '<div class="row"><div class="k">見守り</div><div class="v">' + box(j.watch, '要注意') + '</div></div>';

  const sheet = '<div class="sheet">' + inner + '</div>';
  if (bare) return sheet;
  return '<details open><summary>📄 ニーズ受付シート' +
    (ended ? '（記入済み）' : '（記入中）') + '</summary>' + sheet + '</details>';
}

function needsForm(idx) {
  const c = CONFIG.CALLS[idx];
  S.curCall = idx;
  setTop(CONFIG.TIMES.needs, 'ニーズ受付', 'ニーズ班');
  const body =
    '<div class="fld"><label>ニーズID</label><input type="text" class="readonly" readonly value="（保存すると自動で採番されます）"></div>' +
    '<div class="grp"><div class="gh">ニーズ受付情報</div><div class="gb">' +
      '<div class="fld"><label>受付時間</label><input type="text" class="readonly" readonly value="' + esc(CONFIG.TIMES.needs) + '"></div>' +
      '<div class="fld"><label>担当者</label><input type="text" class="readonly" readonly value="' + esc(CONFIG.STAFF) + '"></div>' +
      '<div class="fld" id="f_method"><label>受付方法<span class="req">必須</span></label>' +
        optsHtml('o_method', ['窓口', '電話', '訪問', '不明', 'その他'], false) +
        '<div class="errmsg"></div></div>' +
    '</div></div>' +
    '<div class="grp"><div class="gh">依頼者情報</div><div class="gb">' +
      '<div class="fld"><label>依頼者<span class="req">必須</span></label>' +
        '<input type="text" id="i_req" class="readonly" readonly></div>' +
      '<div class="fld"><label>電話番号</label><input type="text" id="i_tel" class="readonly" readonly></div>' +
      '<div class="fld"><label>住所</label><input type="text" id="i_addr" class="readonly" readonly></div>' +
      '<div class="fld"><label>種別</label><input type="text" id="i_type" class="readonly" readonly></div>' +
    '</div></div>' +
    '<div class="fld"><label>依頼内容<span class="req">必須</span></label>' +
      '<textarea id="i_body" class="readonly" readonly></textarea></div>';

  show(
    navi('電話が終わりました。<b>受付シートを見ながら、kintoneに入力します。</b><br>' +
         '<span class="muted">ここでは入力の様子を見てもらいます。どの欄が、どこから来た情報なのかに注目してください。</span>') +
    '<div class="split">' +
      '<div class="sheetcol">' + sheetHtml(c) + '</div>' +
      '<div class="formcol">' +
        afPanel('入力する') +
        kin('needs', body, { plus: true }) +
      '</div>' +
    '</div>' + sheetFab()
  );
  $('#afStart').onclick = () => afRun(needsSteps(idx), 'ニーズ管理アプリに保存しました。',
    '保存して次へ', () => saveNeed(idx));
}

/* ニーズ管理アプリに、何がどこから入るのか */
function needsSteps(idx) {
  const c = CONFIG.CALLS[idx];
  const f = S.sheet.fields;
  const steps = [];

  steps.push({ sel: '#o_method', type: 'opt', value: '電話', src: 'sheet',
    label: '受付方法：電話',
    say: '受付シートの「受付方法 ☑ 電話」を、そのまま選びます。' });

  steps.push({ sel: '#i_req', type: 'text', value: f.name || c.requester, src: 'sheet',
    label: '依頼者：' + (f.name || c.requester),
    say: '受付シートに書き取った氏名を入力します。' });

  // 名簿にいるかどうかで、次に起きることが変わります
  if (c.inRoster) {
    const hit = S.roster.find(r => norm(r.name) === norm(f.name || c.requester)) || {};
    steps.push({ sel: null, src: 'roster', label: '「取得」で名簿アプリを検索',
      say: '氏名で名簿アプリを検索すると、<b>' + esc(c.requester) + 'さんが見つかりました</b>。' +
           '今朝、窓口に来られたときに登録されていた方です。' });
    steps.push({ sel: '#i_tel',  type: 'text', value: hit.tel  || '', src: 'roster', label: '電話番号', say: '名簿から自動で入りました。<b>打ち直す必要はありません。</b>' });
    steps.push({ sel: '#i_addr', type: 'text', value: hit.addr || '', src: 'roster', label: '住所', say: '名簿から自動で入りました。' });
    steps.push({ sel: '#i_type', type: 'text', value: hit.type || '被災者', src: 'roster', label: '種別', say: '種別も名簿側で持っています。直すときは名簿を直します。' });
  } else {
    const d = c.newRoster || {};
    steps.push({ sel: null, src: 'roster', label: '「取得」で名簿アプリを検索 → 見つからない',
      say: '<b>' + esc(c.requester) + 'さんは、まだ名簿にいません。</b>災害VCへの最初の相談だからです。' });

    // 基本情報を聞けていないと、名簿に登録できません
    const miss = [];
    if (!f.name) miss.push('氏名');
    if (!f.tel)  miss.push('電話番号');
    if (!f.addr) miss.push('住所');
    if (miss.length) {
      const q = c.questions.filter(x => x.need);
      q.forEach(x => { if (x.set) Object.keys(x.set).forEach(k => { f[k] = x.set[k]; }); });
      steps.push({ sel: null, src: 'talk', label: '⚠ 折り返し電話をかけ直しました',
        say: '<b>' + esc(miss.join('・')) + 'を聞いていなかった</b>ので、名簿に登録できませんでした。' +
             '折り返し電話をして聞き直しています。<br>' +
             '被災された方に二度手間をかけることになりますし、混乱している時期ほど電話はつながりません。', pause: 1100 });
      mark(false, '受付の1回の電話で、基本情報を聞き取れた',
        '氏名・電話番号・住所は、名簿に登録するために必ず必要です。聞き漏らすと折り返し電話になり、' +
        '被災された方に二度手間をかけることになります。混乱している時期ほど、電話がつながらないこともあります。');
    }
    steps.push({ sel: null, src: 'roster', label: '名簿アプリに新しく登録',
      say: '聞き取った氏名・電話番号・住所で、名簿アプリに登録します。<br>' +
           '<b>名簿に登録してから紐づけないと、同じ方のレコードが何件もできてしまいます。</b>' +
           '災害VCでいちばん多い記録の事故です。', pause: 900 });
    // 実際に名簿へ登録します
    if (f.name && !S.roster.some(r => norm(r.name) === norm(f.name))) {
      S.roster.push({ name: f.name, kana: d.kana, tel: f.tel, addr: f.addr, sex: d.sex, age: d.age, type: d.type || '被災者' });
    }
    steps.push({ sel: '#i_tel',  type: 'text', value: f.tel  || '', src: 'roster', label: '電話番号', say: '登録した名簿から、自動で入りました。' });
    steps.push({ sel: '#i_addr', type: 'text', value: f.addr || '', src: 'roster', label: '住所', say: '登録した名簿から、自動で入りました。' });
    steps.push({ sel: '#i_type', type: 'text', value: d.type || '被災者', src: 'roster', label: '種別', say: '名簿の「種別」が入ります。' });
  }

  const body = (f.state || c.modelText) + (S.sheet.memo.length ? '　' + S.sheet.memo.join(' ') : '');
  steps.push({ sel: '#i_body', type: 'text', value: body, src: 'sheet',
    label: '依頼内容',
    say: '受付シートの「依頼内容」と「補足メモ」を、<b>省略せずに</b>書き写します。<br>' +
         'この文章だけを見て、現地調査班は現場へ向かいます。' +
         '「泥の撤去」とだけ書いても、どこが・どれくらい・誰が困っているのかが伝わりません。', pause: 900 });

  return steps;
}

/* 名簿アプリのルックアップ。
   本物のkintoneと同じように、完全一致でなくても候補を探します。 */
function saveNeed(idx) {
  const c = CONFIG.CALLS[idx];
  const name = $('#i_req').value.trim() || S.sheet.fields.name || c.requester;
  const body = $('#i_body').value.trim();

  S.needs.push({
    id: S.needs.length + 1,
    requester: name,
    tel: $('#i_tel').value, addr: $('#i_addr').value,
    body: body, method: pick1('o_method'),
    status: '受付中',
    surveyNeeded: S.sheet.judge.survey || '必要',   // 受付シートの判断をここに引き継ぐ
    call: c, assigned: [], surveyed: false
  });

  show(
    navi('保存できました。ニーズ管理アプリの一覧に、<b>ニーズID ' + S.needs.length + '</b> として並びました。') +
    needsList() +
    '<button class="btn btn-lg" onclick="' + (idx + 1 < CONFIG.CALLS.length ? 'sceneCall(' + (idx + 1) + ')' : 'bump();sceneSurveyIntro()') + '">' +
      (idx + 1 < CONFIG.CALLS.length ? '次の電話を受ける' : '現地調査班の仕事へ進む') + '</button>'
  );
}

/* ニーズ管理アプリの一覧表示 */
function needsList(highlightLast) {
  return kin('needs',
    '<div class="tblwrap"><table class="tbl"><tr>' +
      '<th>ニーズID</th><th>進捗状況</th><th>依頼者</th><th>依頼内容</th><th>必要人数</th></tr>' +
      S.needs.map((n, i) =>
        '<tr class="' + (highlightLast !== false && i === S.needs.length - 1 ? 'new' : '') + '">' +
          '<td>' + n.id + '</td>' +
          '<td>' + statusBadge(n.status) + (n.crisis ? ' <span class="badge b-red">要優先</span>' : '') + '</td>' +
          '<td>' + esc(n.requester) + '</td>' +
          '<td>' + esc(n.body) + '</td>' +
          '<td>' + (n.people ? n.people + '名' : '－') + '</td>' +
        '</tr>').join('') +
    '</table></div>', { plus: true });
}
function statusBadge(s) {
  const m = { '受付中': 'b-blue', '現地調査中': 'b-orange', '活動中': 'b-orange', '完了': 'b-green', '取消': 'b-gray' };
  return '<span class="badge ' + (m[s] || 'b-gray') + '">' + esc(s) + '</span>';
}

/* ============================================================
   5. 現地調査班
   ============================================================ */
function sceneSurveyIntro() {
  setTop(CONFIG.TIMES.survey, '現地調査', '現地調査班');
  const go   = S.needs.filter(n => n.surveyNeeded === '必要').length;
  const skip = S.needs.filter(n => n.surveyNeeded === '不要').length;
  const ask  = S.needs.filter(n => n.surveyNeeded !== '必要' && n.surveyNeeded !== '不要').length;
  show(
    navi('<b>現地調査班</b>の仕事です。受付シートで<b>「現地調査 必要」</b>としたニーズの現場へ行き、' +
         '<b>スマホから</b>ニーズ管理アプリに追記します。<br>' +
         'ここで入れた<b>必要人数と資機材</b>が、あとの班の準備の基準になります。') +
    '<div class="panel">' +
      '<h2>受付時の判断のとおりに動きます</h2>' +
      '<div class="tblwrap"><table class="tbl"><tr><th>ニーズID</th><th>依頼者</th><th>受付時の判断</th><th>これから</th></tr>' +
        S.needs.map(n => '<tr><td>' + n.id + '</td><td>' + esc(n.requester) + '</td>' +
          '<td>現地調査 ' + esc(n.surveyNeeded) + '</td>' +
          '<td>' + (n.surveyNeeded === '必要' ? '<span class="badge b-orange">現場へ行く</span>'
                  : n.surveyNeeded === '不要' ? '<span class="badge b-gray">行かずに入力</span>'
                  : '<span class="badge b-blue">班長に相談</span>') + '</td></tr>').join('') +
      '</table></div>' +
      '<p class="muted" style="margin-top:10px">' +
        (skip || ask
          ? '災害の規模が大きくなると、<b>全件を見に行くことは物理的にできません。</b>' +
            'だから受付の時点で、どれを見に行くかを判断します。'
          : '受け付けた ' + go + ' 件すべてを見に行きます。') + '</p>' +
      '<button class="btn btn-lg" style="margin-top:6px" onclick="goSurvey(0)">1件目へ</button>' +
    '</div>'
  );
}

/* 受付時の判断に応じて、行き先を振り分けます */
function goSurvey(i) {
  if (i >= S.needs.length) { bump(); return sceneRecept(); }
  const n = S.needs[i];
  if (n.surveyNeeded === '不要') return sceneSurvey(i, true);
  if (n.surveyNeeded !== '必要' && !n.chiefAsked) return sceneAskChief(i);
  return sceneSurveyBrief(i);
}

/* 現地へ出る前に、気をつけることを確認します */
function sceneSurveyBrief(i) {
  const n = S.needs[i];
  setTop(CONFIG.TIMES.survey, '現地調査（出発前）', '現地調査班');
  show(
    navi('これから<b>' + esc(n.requester) + 'さんのお宅</b>へ向かいます。<br>' +
         '現地調査は、職員が被災された方のお宅に上がる数少ない場面です。<br>' +
         '<span class="muted">ここでの振る舞いが、そのまま社協の信用になります。</span>') +
    '<div class="panel" style="background:#f6f8f8">' +
      '<p style="margin:0 0 6px"><b>ニーズID ' + n.id + '　' + esc(n.requester) + 'さん</b>　' + esc(n.addr) + '</p>' +
      '<p class="muted" style="margin:0">' + esc(n.body) + '</p>' +
    '</div>' +
    '<div class="panel">' +
      '<h2>現地調査で気をつけること</h2>' +
      CONFIG.SURVEY_CAUTIONS.map((c, k) =>
        '<div class="caution"><div class="ct"><span class="cn">' + (k + 1) + '</span>' + esc(c.t) + '</div>' +
        '<div class="cd">' + c.d + '</div></div>').join('') +
      '<button class="btn btn-lg" style="margin-top:16px" onclick="sceneSurvey(' + i + ',false)">調査をする</button>' +
    '</div>'
  );
}

/* 「判断できない（要相談）」… 班長に相談する */
function sceneAskChief(i) {
  const n = S.needs[i];
  setTop(CONFIG.TIMES.survey, '現地調査（相談）', 'ニーズ班');
  show(
    navi('受付シートで<b>「判断できない（要相談）」</b>としたニーズです。<br>班長に相談します。') +
    '<div class="phone">' + pSil('staff') +
      '<div class="ring">ニーズ班 班長</div>' +
      '<p class="line">「ニーズID ' + n.id + '、' + esc(n.requester) + 'さんの件やね。」</p>' +
      '<p class="line">「迷ったときは<b>行っておこう</b>。行かずに見立てを外すより、行って空振りするほうがずっとええ。」</p>' +
      '<p class="line">「その代わり、順番は後ろでかまん。急ぐ現場を先に回して。」</p>' +
    '</div>' +
    '<div class="panel">' +
      '<p class="muted" style="margin:0 0 12px">迷ったら相談する。相談したうえで動く。' +
      'ひとりで「不要」と決めてしまうより、はるかに安全です。</p>' +
      '<button class="btn btn-lg" onclick="chiefDecided(' + i + ')">現場へ向かう</button>' +
    '</div>'
  );
}
function chiefDecided(i) {
  S.needs[i].chiefAsked = true;
  mark(true, '判断に迷ったとき、ひとりで決めずに班長に相談した',
    '「判断できない（要相談）」は、逃げではなく正しい選択肢です。受付シートにこの欄があるのは、' +
    'ひとりで抱えなくてよいと示すためでもあります。');
  sceneSurvey(i, false);
}

function sceneSurvey(i, desk) {
  if (i >= S.needs.length) { bump(); return sceneRecept(); }
  const n = S.needs[i];
  const sv = n.call.survey;
  n.deskOnly = !!desk;
  setTop(CONFIG.TIMES.survey, (desk ? '現地調査なしで入力' : '現地調査') + '（' + (i + 1) + '/' + S.needs.length + '）',
         desk ? 'ニーズ班' : '現地調査班');

  const body =
    '<div class="fld"><label>ニーズID</label><input type="text" class="readonly" readonly value="' + n.id + '"></div>' +
    '<div class="fld"><label>依頼者</label><input type="text" class="readonly" readonly value="' + esc(n.requester) + '"></div>' +
    '<div class="fld"><label>依頼内容（ニーズ班が入力）</label><textarea class="readonly" readonly>' + esc(n.body) + '</textarea></div>' +
    '<hr class="sep">' +
    (desk
      ? '<div class="fld"><label>現地の情報</label>' +
        '<div style="background:#f6f8f8;border:1px dashed #c9d1d4;border-radius:6px;padding:11px;font-size:1rem;color:#6b7a80">' +
        '現地調査を行っていないため、現場の写真も、現地での聞き取りもありません。<br>' +
        '<b>電話で聞き取った内容だけ</b>が手がかりです。</div></div>'
      : '<div class="fld"><label>写真</label>' +
        '<div id="photoBox" class="photobox">まだ撮影していません</div></div>' +
        '<div class="fld"><label>現地で聞き取った内容</label>' +
        '<div style="background:#fbfaf5;border:1px dashed #d8cdb4;border-radius:6px;padding:11px;font-size:1rem">' + esc(sv.memo) + '</div></div>') +
    '<hr class="sep">' +
    '<div class="fld"><label>被災状況</label>' + optsHtml('o_dmg', ['床上浸水', '床下浸水', '一部破損', '土砂流入', 'その他'], true) + '</div>' +
    '<div class="fld"><label>依頼分類</label>' + optsHtml('o_cat', ['土砂撤去', '荷物運び出し', '清掃', 'その他'], true) + '</div>' +
    '<div class="fld"><label>必要人数等</label>' + optsHtml('o_ppl', CONFIG.PEOPLE_CHOICES, false) + '</div>' +
    '<div class="fld"><label>資機材等</label>' + optsHtml('o_eq', CONFIG.EQUIPMENT, true) + '</div>' +
    '<div class="fld"><label>危機介入の必要性</label>' + optsHtml('o_cri', ['必要あり'], true) + '</div>' +
    '<div class="fld"><label>特記事項・メモ</label><textarea id="i_memo" class="readonly" readonly></textarea></div>';

  show(
    (desk
      ? navi('このニーズは<b>現地調査を「不要」</b>と判断しました。現場には行かず、' +
             '電話で聞き取った内容だけで<b>必要人数</b>と<b>資機材</b>を決めます。')
      : navi('現場に着きました。<b>写真を撮り、状況を確認して、その場でスマホからkintoneに入力します。</b><br>' +
             '<span class="muted">何をどう判断して入力するのかを、1項目ずつ見てください。</span>')) +
    '<div style="max-width:430px;margin:0 auto">' +
      '<p class="muted center">' + (desk ? '🖥 センターで入力しています' : '📱 スマホから入力しています') + '</p>' +
      afPanel('現地調査の結果を入力する') +
      kin('needs', body) +
    '</div>'
  );
  $('#afStart').onclick = () => afRun(surveySteps(i, desk),
    'ニーズ管理アプリに保存しました。', '保存して次へ', () => saveSurvey(i));
}

/* 現地調査で分かったことが、どう入るのか */
function surveySteps(i, desk) {
  const n = S.needs[i], sv = n.call.survey;
  const src = desk ? 'talk' : 'field';
  const seen = desk ? '電話で聞き取った内容から' : '現場を見て';
  const steps = [];

  if (!desk) {
    steps.push({ sel: '#photoBox', src: 'field', label: '写真を撮影して添付',
      run: function () { const b = $('#photoBox'); if (b) { b.className = ''; b.innerHTML = SCENES[sv.scene]; } },
      say: '<b>「記録のために写真を撮らせていただいてよろしいですか」</b>とひと言断ってから撮ります。<br>' +
           '被害の範囲が分かるように、引きの写真と寄りの写真を複数枚。' +
           'この写真を見て、マッチング班と資機材班が人数と道具を決めます。<br>' +
           '<span class="muted">撮った写真は災害VC内の判断にだけ使い、SNSなどには載せません。</span>',
      pause: 900 });
  }

  steps.push.apply(steps, [
    { sel: '#o_dmg', type: 'opt', values: sv.damage, src: src,
      label: '被災状況：' + sv.damage.join('・'),
      say: seen + '判断します。浸水の深さは、後の資機材の量に直結します。' },
    { sel: '#o_cat', type: 'opt', values: sv.category, src: src,
      label: '依頼分類：' + sv.category.join('・'),
      say: '何をする活動なのかを分類します。マッチングのときの目安になります。' },
    { sel: '#o_ppl', type: 'opt', value: sv.people + '名', src: src,
      label: '必要人数：' + sv.people + '名',
      say: '<b>人数に決まった正解はありません。</b>現場の広さ、その日のボランティアの集まり具合、' +
           'センターの体制で変わります。ここでは' + sv.people + '名と見立てました。' },
    { sel: '#o_eq', type: 'opt', values: sv.equip, src: src,
      label: '資機材：' + sv.equip.join('、'),
      say: '<b>資機材班はこの記載どおりに準備します。</b>' +
           (sv.equip.indexOf('軽トラック') >= 0
             ? '土砂は「運び出す先」まで考える必要があるので、軽トラックも入れます。'
             : '運び出しに車が要るときは、軽トラックも忘れずに入れます。') },
    (sv.crisis
      ? { sel: '#o_cri', type: 'opt', value: '必要あり', src: src,
          label: '危機介入の必要性：必要あり',
          say: '受付の時点で紙のシートに書いた判断を、kintone側にも残します。' +
               'これで<b>全班が「この現場は優先」と分かります</b>。', pause: 850 }
      : { sel: null, src: src, label: '危機介入の必要性：チェックなし',
          say: 'ご家族と同居で母屋も無事です。ここにチェックを付けると、本当に急ぐ方が埋もれてしまいます。' }),
    { sel: '#i_memo', type: 'text', value: sv.memoTip || '', src: src,
      label: '特記事項・メモ',
      say: '人数や資機材に正解がないからこそ、<b>そう判断した理由</b>を残します。<br>' +
           '「4名」とだけ書いてあっても、資機材班もマッチング班も、増やしていいのか減らしていいのか判断できません。', pause: 900 }
  ]);
  return steps;
}

function saveSurvey(i) {
  const n = S.needs[i];
  const sv = n.call.survey;

  n.status   = '活動中';
  n.people   = sv.people;
  n.equip    = sv.equip.slice();
  n.crisis   = sv.crisis;
  n.category = sv.category.slice();
  n.memo     = sv.memoTip || '';
  n.surveyed = true;

  // 危機介入が必要な方の現場を、見ずに済ませていないか（判断は受付シートで行っています）
  if (sv.crisis && n.deskOnly) {
    mark(false, '現地調査の要否を、根拠をもって判断した',
      esc(n.requester) + 'さんは<b>危機介入が必要な方</b>でした。生活が成り立っていない方の現場を見ずに、' +
      '電話の聞き取りだけで人数と資機材を決めるのは危険です。全件は回れなくても、' +
      '<b>危機介入ありと判断した現場は必ず見に行きます</b>。迷ったら「判断できない（要相談）」で班長に相談してください。');
  } else if (sv.crisis) {
    mark(true, '現地調査の要否を、根拠をもって判断した',
      '危機介入が必要な現場を、きちんと見に行けました。<b>災害の規模が大きくなると全件は回れません。</b>' +
      'だからこそ受付の時点で、どれを優先して見に行くかを判断します。' +
      '聞き取りで状況がはっきりしている現場は「不要」でかまいません。');
  }

  show(
    navi('保存しました。この内容が、そのまま<b>マッチング班</b>と<b>資機材班</b>の判断材料になります。') +
    needsList() +
    '<button class="btn btn-lg" onclick="goSurvey(' + (i + 1) + ')">' +
      (i + 1 < S.needs.length ? '次のニーズへ' : '災害VCへ戻る（当日受付班へ）') + '</button>'
  );
}

/* ============================================================
   6. 当日受付班
   ============================================================ */
function sceneRecept() {
  setTop(CONFIG.TIMES.recept, '当日受付', '当日受付班');
  show(
    navi('<b>当日受付班</b>の仕事です。ボランティアには<b>QRコード</b>を読んでもらい、Googleフォームに入力してもらいます。<br>' +
         '送信されると、自動で<b>当日受付アプリ</b>に登録されます。') +
    '<div class="panel center">' +
      '<div style="font-size:.92rem;color:var(--sub);margin-bottom:6px">受付テントに貼ってあるQRコード</div>' +
      qrSvg() +
      '<p class="muted">読み取り → Googleフォーム入力 → 送信 → 当日受付アプリへ自動登録</p>' +
      '<button class="btn btn-lg" id="startRecBtn" onclick="startArrivals()">受付を開始する</button>' +
    '</div>' +
    '<div id="recArea"></div>'
  );
}
function qrSvg() {
  // 飾りのQR風図形（読み取れません）
  let cells = '';
  const seed = [1,0,1,1,0,1,0,0,1,1,0,0,1,0,1,1,1,0,0,1,0,1,1,0,1,0,0,1,1,0,1,1,0,1,0,0];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++)
    if (seed[y * 6 + x]) cells += '<rect x="' + (20 + x * 12) + '" y="' + (20 + y * 12) + '" width="12" height="12"/>';
  return '<svg width="120" height="120" viewBox="0 0 112 112" style="background:#fff;border:1px solid #ccc">' +
    '<g fill="#222">' + cells +
    '<rect x="8" y="8" width="26" height="26" fill="none" stroke="#222" stroke-width="5"/>' +
    '<rect x="78" y="8" width="26" height="26" fill="none" stroke="#222" stroke-width="5"/>' +
    '<rect x="8" y="78" width="26" height="26" fill="none" stroke="#222" stroke-width="5"/></g></svg>';
}

let arrivalsStarted = false;
function startArrivals() {
  if (arrivalsStarted) return;          // 二重登録の防止（何度も押せてしまう不具合の対策）
  arrivalsStarted = true;
  const b = $('#startRecBtn');
  if (b) { b.disabled = true; b.textContent = '受付中…'; }
  $('#recArea').innerHTML = '<div id="recTbl"></div>';
  let i = 0;
  const tick = setInterval(() => {
    if (i >= CONFIG.VOLUNTEERS.length) {
      clearInterval(tick);
      walkin();
      return;
    }
    const v = CONFIG.VOLUNTEERS[i];
    const nm = v.last + ' ' + v.first;
    if (S.vols.some(x => x.name === nm)) { i++; return; }   // 同姓同名の重複を作らない
    S.vols.push(Object.assign({}, v, { name: nm, assignedTo: null }));
    $('#recTbl').innerHTML = recList();
    i++;
  }, 700);
}
function recList() {
  return kin('recept',
    '<div class="tblwrap"><table class="tbl"><tr>' +
      '<th>氏名</th><th>参加種別</th><th>ボランティア保険</th><th>軽トラック</th></tr>' +
      S.vols.map((v, i) => '<tr class="' + (i === S.vols.length - 1 ? 'new' : '') + '">' +
        '<td>' + esc(v.name) + '</td><td>' + esc(v.kind) + '</td>' +
        '<td>' + (v.ins === '加入済み' ? '<span class="badge b-green">加入済み</span>' : '<span class="badge b-red">未加入</span>') + '</td>' +
        '<td>' + esc(v.truck) + '</td></tr>').join('') +
    '</table></div>', { plus: true });
}

function walkin() {
  const w = CONFIG.WALKIN;
  $('#recArea').insertAdjacentHTML('beforeend',
    '<div class="phone fade">' + pSil('elderM') + '<div class="ring">受付に男性が来られました</div>' +
    '<p class="line">「' + esc(w.say) + '」</p>' +
    '<div class="who">' + esc(w.last + ' ' + w.first) + 'さん（' + esc(w.age) + '）</div></div>' +
    '<div class="panel"><p>スマホをお持ちでない方、操作が苦手な方には、<b>職員が代わりに入力</b>します。' +
    '断らずに受け付けるのが当日受付班の役割です。</p>' +
    '<button class="btn btn-lg" onclick="walkinForm()">代わりに入力する</button></div>');
}
function walkinForm() {
  const w = CONFIG.WALKIN;
  modal(
    '<h3>災害V活動当日受付　新規レコード</h3>' +
    '<p class="muted">聞き取りながら、職員が代わりに入力します。</p>' +
    ['姓', '名', '携帯電話', '参加種別', 'ボランティア保険の加入の有無', '軽トラックの有無']
      .map((l, i) => '<div class="fld"><label>' + l + '</label><input type="text" class="readonly" readonly value="' +
        esc([w.last, w.first, w.tel, w.kind, w.ins, w.truck][i]) + '"></div>').join('') +
    '<div class="btnrow end"><button class="btn" onclick="saveWalkin()">保存</button></div>'
  );
}
function saveWalkin() {
  const w = CONFIG.WALKIN;
  const nm = w.last + ' ' + w.first;
  if (!S.vols.some(x => x.name === nm)) {
    S.vols.push(Object.assign({}, w, { name: nm, assignedTo: null }));
  }
  closeModal();
  $('#recArea').innerHTML = '<div id="recTbl">' + recList() + '</div>' +
    '<div class="panel"><p>本日の受付は <b>' + S.vols.length + '名</b> です。' +
    'このアプリが、そのまま<b>ボランティア名簿</b>になります。</p>' +
    '<button class="btn btn-lg" onclick="bump();sceneOrientation()">オリエンテーション・マッチング班へ</button></div>';
}

/* ============================================================
   6-2. オリエンテーション
   ------------------------------------------------------------
   マッチングの前に、ボランティア全員へ説明する場面。
   全国共通の内容は動画に任せ、職員はローカルルールを口頭で補う。
   ============================================================ */
function sceneOrientation() {
  const O = CONFIG.ORIENTATION;
  setTop('11:00', 'オリエンテーション', 'マッチング班');
  show(
    navi('<b>オリエンテーション</b>です。マッチングの前に、集まったボランティア' + S.vols.length + '名に説明します。<br>' +
         'ここを飛ばすと、事故も、被災者とのトラブルも起きやすくなります。') +
    '<div class="panel center" style="padding-bottom:10px">' +
      silGroup() +
      '<p class="muted" style="margin:6px 0 0">集まったボランティア ' + S.vols.length + '名</p>' +
    '</div>' +
    '<div class="panel">' +
      '<h2>1. 動画を見てもらう</h2>' +
      '<p class="muted">' + O.VIDEO_NOTE + '</p>' +
      '<div class="screen" id="screen">' +
        '<div class="scr-title">' + esc(O.VIDEO_TITLE) + '</div>' +
        '<button class="scr-play" id="playBtn" onclick="playVideo()">▶</button>' +
        '<div class="scr-bar"><div id="scrBar"></div></div>' +
      '</div>' +
      '<p style="font-size:1rem;margin:12px 0 4px">この動画で扱われる内容：</p>' +
      '<ul style="margin:0;font-size:.95rem;color:#555">' +
        O.VIDEO_POINTS.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' +
    '</div>' +
    '<div id="ruleArea"></div>'
  );
}

/* 上映をまねる（実際の動画は流れません） */
function playVideo() {
  const btn = $('#playBtn'); if (!btn || btn.disabled) return;
  btn.disabled = true; btn.textContent = '再生中';
  $('#screen').classList.add('playing');
  let p = 0;
  const tick = setInterval(() => {
    p += 8;
    $('#scrBar').style.width = Math.min(100, p) + '%';
    if (p >= 100) {
      clearInterval(tick);
      btn.textContent = '✓ 上映しました';
      $('#screen').classList.remove('playing');
      $('#screen').classList.add('done');
      drawRules();
    }
  }, 130);
}
function drawRules() {
  const O = CONFIG.ORIENTATION;
  $('#ruleArea').innerHTML =
    '<div class="panel fade">' +
      '<h2>2. ローカルルールを口頭で伝える</h2>' +
      '<p class="muted">動画では扱えない、<b>この地域・この災害でしか通じないこと</b>を伝えます。' +
      '伝える項目を選んでください。</p>' +
      optsHtml('o_rules', O.LOCAL_RULES.map(r => r.text), true) +
      '<button class="btn btn-lg" style="margin-top:14px" onclick="saveOrientation()">説明を終えて、マッチングへ</button>' +
    '</div>';
  $('#ruleArea').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function saveOrientation() {
  const O = CONFIG.ORIENTATION;
  const said = picked('o_rules');
  const musts = O.LOCAL_RULES.filter(r => r.must);
  const missed = musts.filter(r => said.indexOf(r.text) < 0);

  mark(true, '動画で、全国共通の心得を伝えた',
    '心構え・服装・けがや熱中症の予防といった共通の内容は、動画に任せると毎回同じ質で伝えられます。' +
    '職員が毎回しゃべると、人によって説明が抜けます。');

  mark(missed.length === 0, 'ローカルルールを口頭で伝えた',
    missed.length === 0
      ? '集合時間、通行止め、体調不良の申し出、依頼書を超える依頼への対応。この4つは動画では伝えられません。口頭で補うのが職員の役割です。'
      : '伝え漏れがありました：<b>' + esc(missed.map(r => r.text).join(' / ')) + '</b><br>' +
        'とくに「活動依頼書に書かれた内容を超える依頼は、その場で受けずにセンターへ連絡する」を伝えないと、' +
        'ボランティアが善意で引き受けてしまい、時間も安全も管理できなくなります。');

  bump();
  sceneMatching();
}

/* ============================================================
   9-2. 帰着（ねぎらいと安全の確認）
   ============================================================ */
function sceneReturn() {
  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  const members = S.vols.filter(v => v.assignedTo === n.id).map(v => v.name);
  setTop('15:30', '帰着', 'マッチング班');
  show(
    navi('ボランティアが戻ってきました。<br><b>最初に何をしますか。</b>') +
    '<div class="phone">' + pSil('volun') +
      '<div class="ring">15:30  ' + esc(members.join('、')) + 'さんが戻ってきました</div>' +
      '<p class="line">泥だらけの長靴のまま、疲れた様子で受付に立っています。</p>' +
    '</div>' +
    '<div class="panel"><h2>どう迎えますか？</h2>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerReturn(1)">① さっそく活動の内容を聞き取り、活動報告アプリに入力する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerReturn(2)">② ねぎらいの言葉をかけ、けがや事故がなかったかを確認する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerReturn(3)">③ まず資機材を洗って返却してもらう</button>' +
      '</div>' +
    '</div>'
  );
}
function answerReturn(a) {
  const ok = (a === 2);
  const d = ok
    ? 'まず「おかえりなさい、お疲れさまでした」。そのうえで、けが・事故・ヒヤリハットの有無を確認します。' +
      '<b>記録より先に、人の安全と気持ちです。</b>'
    : (a === 1
        ? 'いきなり聞き取りから入ると、ボランティアは「報告のために働かされた」と感じます。' +
          'そして、けがをしていても言い出しにくくなります。<b>まずねぎらいと安全確認</b>です。'
        : '資機材の返却は大事ですが、その前に人です。まずねぎらい、けがや事故がなかったかを確認します。');
  mark(ok, '帰ってきたボランティアを、まずねぎらって安全を確認した', d);

  modal('<h3>' + (ok ? '✓ その順番で正解です' : '順番を確認しましょう') + '</h3>' +
    '<p>' + d + '</p>' +
    (ok ? '<p>「おかえりなさい、お疲れさまでした。おけがはありませんでしたか」<br>' +
          'そう声をかけると、' + esc((S.vols.find(v => v.assignedTo != null) || {}).name || '') + 'さんたちの表情がゆるみました。</p>'
        : '<p class="muted">改めて、ねぎらいの言葉から声をかけます。</p>') +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();hiyariHat()">「おけがはありませんでしたか」と聞く</button></div>');
}

function hiyariHat() {
  const v = S.vols.filter(x => x.assignedTo != null)[2] || S.vols[0];
  show(
    navi('声をかけたことで、言い出せていなかったことが出てきました。<br>' +
         '<b>聞かなければ、そのまま帰っていた話です。</b>') +
    '<div class="phone">' + pSil('volun') +
      '<div class="ring">' + esc(v.name) + 'さんから</div>' +
      '<p class="line">「けがってほどじゃないんですけど…」</p>' +
      '<p class="line">「午後、少しふらついて、しゃがみ込んでしまって。」</p>' +
      '<p class="line">「水は飲んでたんですけど、暑かったので。今はもう大丈夫です。」</p>' +
    '</div>' +
    '<div class="panel"><h2>どう対応しますか？</h2>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerHiyari(1)">① 休んで水分をとってもらい、様子を見て必要なら受診を勧める。記録にも残す</button>' +
        '<button class="btn-gray btn-lg" onclick="answerHiyari(2)">② 本人が大丈夫と言うので、お礼を言って帰ってもらう</button>' +
        '<button class="btn-gray btn-lg" onclick="answerHiyari(3)">③ 活動報告に書いておき、対応は本人にまかせる</button>' +
      '</div>' +
    '</div>'
  );
}
function answerHiyari(a) {
  const ok = (a === 1);
  let d;
  if (ok) {
    d = '正解です。涼しい場所で休んでもらい、水分・塩分をとってもらう。顔色や受け答えを見て、少しでも不安があれば受診を勧める。' +
        'そして<b>記録に残す</b>。記録があるから、翌日の班編成で「暑い時間帯の作業は人を増やす」といった判断ができます。' +
        'けがや事故は、ボランティア活動保険の手続きにもつながります。';
  } else if (a === 2) {
    d = '本人は「大丈夫」と言うものです。熱中症は帰宅後に悪化することがあります。' +
        '休んでもらい、水分をとってもらい、様子を確認してから帰ってもらってください。' +
        'そして記録に残さないと、同じことが翌日も起きます。';
  } else {
    d = '記録に残したのは良い判断ですが、それだけでは<b>いま目の前にいる方の安全</b>が守れていません。' +
        'まず休んでもらい、水分をとってもらう。必要なら受診を勧める。対応と記録は両方必要です。';
  }
  mark(ok, 'ヒヤリハットに、その場で対応して記録した', d);
  modal('<h3>' + (ok ? '✓ その対応で正解です' : '確認しましょう') + '</h3><p>' + d + '</p>' +
    '<p class="muted">出発前の体調確認と、帰着後の安全確認。この2つがそろって、はじめて' +
    '「安心して活動できる災害VC」になります。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();bump();sceneReport()">活動報告の入力へ</button></div>');
}

/* ============================================================
   7. マッチング班（このゲームの中心）
   ============================================================ */
let selNeed = null;
function sceneMatching() {
  setTop(CONFIG.TIMES.matching, 'オリエン・マッチング', 'マッチング班');
  selNeed = S.needs[0] ? S.needs[0].id : null;
  const needTotal = S.needs.reduce((a, n) => a + n.people, 0);
  const usable = S.vols.filter(v => v.ins === '加入済み').length;
  show(
    navi('<b>マッチング班</b>の仕事です。ニーズと、受付を済ませたボランティアを組み合わせます。<br>' +
         '<b>ニーズを選んでから、送り出す人を選んでください。</b>') +
    '<div class="panel" style="background:#fff8ee;border-color:#f3ddb5">' +
      '<p style="margin:0;font-size:1rem">今日の必要人数は合計 <b>' + needTotal + '名</b>、' +
      '受け付けたボランティアは <b>' + S.vols.length + '名</b>です。<br>' +
      '<span class="muted">全部は埋まりません。何を先にするか決めるのが、この班の仕事です。</span></p>' +
    '</div>' +
    '<div id="matchArea"></div>'
  );
  drawMatching();
}

function drawMatching() {
  const needsHtml = S.needs.map(n => {
    const cnt = S.vols.filter(v => v.assignedTo === n.id).length;
    const full = cnt >= n.people, over = cnt - n.people;
    return '<div class="ncard' + (selNeed === n.id ? ' sel' : '') + '" onclick="selNeed=' + n.id + ';drawMatching()">' +
      '<div class="t">ニーズID ' + n.id + '　' + esc(n.requester) + 'さん' +
        (n.crisis ? ' <span class="badge b-red">危機介入 必要あり</span>' : '') +
        (n.deskOnly ? ' <span class="badge b-gray">現地調査なし</span>' : '') + '</div>' +
      '<div class="m">' + esc(n.category.join('・')) + '／必要 ' + n.people + '名<br>資機材：' + esc(n.equip.join('、')) + '</div>' +
      '<div style="margin-top:7px;font-size:1rem;font-weight:bold;color:' + (full ? 'var(--green)' : 'var(--orange-d)') + '">' +
        cnt + ' / ' + n.people + ' 名' +
        (over > 0 ? '　<span class="badge b-blue">+' + over + '名</span>' : full ? '　✓' : '') + '</div>' +
    '</div>';
  }).join('');

  const volsHtml = S.vols.map((v, i) => {
    const mine = v.assignedTo === selNeed;
    const other = v.assignedTo != null && !mine;
    return '<div class="vchip' + (mine ? ' on' : '') + (other ? ' used' : '') + '" onclick="toggleVol(' + i + ')">' +
      '<span>' + esc(v.name) + '</span>' +
      '<span class="tag">' +
        (v.truck === 'あり' ? '<span class="badge b-orange">軽トラ</span> ' : '') +
        (v.ins === '加入済み' ? '' : '<span class="badge b-red">保険未加入</span> ') +
        (other ? '<span class="badge b-gray">ID' + v.assignedTo + 'へ</span>' : '') +
      '</span></div>';
  }).join('');

  const assignedAll = S.vols.filter(v => v.assignedTo != null).length;
  const free = S.vols.filter(v => v.assignedTo == null).length;
  $('#matchArea').innerHTML =
    '<div class="mrow">' +
      '<div class="mcol"><h2 style="font-size:1.06rem">今日のニーズ</h2>' + needsHtml +
        '<p class="muted" style="font-size:.88rem">必要人数を<b>超えて</b>入れることもできます。' +
        '土砂の量が読めない現場などは、多めに入ってもらう判断もあります。</p></div>' +
      '<div class="mcol"><h2 style="font-size:1.06rem">受付を済ませたボランティア</h2>' + volsHtml +
        '<p class="muted" style="margin-top:8px">割り当て済み ' + assignedAll + '名／' +
        '<b style="color:' + (free ? 'var(--orange-d)' : 'var(--sub)') + '">まだ決まっていない方 ' + free + '名</b></p></div>' +
    '</div>' +
    '<div class="panel"><p class="muted" style="margin:0 0 10px">組み合わせが決まったら、活動依頼書を発行して印刷し、ボランティアに渡します。</p>' +
      '<button class="btn btn-lg" onclick="sceneMatchReview()"' + (assignedAll === 0 ? ' disabled' : '') + '>送り出す前に確認する</button></div>';
}

/* ============================================================
   7-2. 送り出す前の確認
   ------------------------------------------------------------
   ・人数がそろわない現場をどうするか
   ・活動先が決まらなかった方をどうするか
   どちらも「正解がひとつ」ではありませんが、帰ってもらうのが
   最初の選択肢ではない、というのが要点です。
   ============================================================ */
function sceneMatchReview() {
  const short = S.needs.filter(n => S.vols.filter(v => v.assignedTo === n.id).length < n.people);
  const free  = S.vols.filter(v => v.assignedTo == null && v.ins === '加入済み');
  setTop('11:40', '送り出す前の確認', 'マッチング班');

  let q = '';
  if (short.length) {
    const n = short[0], cnt = S.vols.filter(v => v.assignedTo === n.id).length;
    q += '<div class="panel">' +
      '<h2>人数がそろっていない現場があります</h2>' +
      '<p><b>ニーズID ' + n.id + '　' + esc(n.requester) + 'さん</b>　' +
      '必要 ' + n.people + '名 に対して <b>' + cnt + '名</b>です。</p>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerShort(1)">① ' + cnt + '名で送り出し、できるところまで進めてもらう（残りは翌日）</button>' +
        '<button class="btn-gray btn-lg" onclick="answerShort(2)">② 今日は見送り、人がそろう日に改めて伺うと連絡する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerShort(3)">③ 危機介入が必要な現場から1名回して、人数をそろえる</button>' +
      '</div></div>';
  } else if (free.length) {
    q += surplusPanel(free.length);
  } else {
    q += '<div class="panel"><p>すべての現場に人数がそろい、待っている方もいません。' +
         'このまま活動依頼書を発行します。</p>' +
         '<button class="btn btn-lg" onclick="issueDoc()">活動依頼書を発行する</button></div>';
  }

  show(
    navi('送り出す前に確認します。<b>人数がそろわない現場</b>と、' +
         '<b>活動先が決まっていないボランティア</b>を、どう扱うか決めてください。<br>' +
         '<span class="muted">どちらにも「唯一の正解」はありません。ただし、まず考える順番はあります。</span>') +
    '<div class="panel"><div class="tblwrap"><table class="tbl">' +
      '<tr><th>ニーズID</th><th>依頼者</th><th>必要</th><th>割当</th></tr>' +
      S.needs.map(n => {
        const c = S.vols.filter(v => v.assignedTo === n.id).length;
        return '<tr><td>' + n.id + '</td><td>' + esc(n.requester) + (n.crisis ? ' <span class="badge b-red">要優先</span>' : '') + '</td>' +
          '<td>' + n.people + '名</td><td><b style="color:' + (c >= n.people ? 'var(--green)' : 'var(--red)') + '">' + c + '名</b></td></tr>';
      }).join('') +
    '</table></div>' +
    '<p class="muted" style="margin:10px 0 0">活動先が決まっていない方：<b>' + free.length + '名</b></p></div>' +
    q
  );
}

function surplusPanel(cnt) {
  return '<div class="panel">' +
    '<h2>活動先が決まっていない方が ' + cnt + '名います</h2>' +
    '<p class="muted">せっかく来てくださった方たちです。どうしますか？</p>' +
    '<div class="btnrow" style="flex-direction:column">' +
      '<button class="btn-gray btn-lg" onclick="answerSurplus(1)">① 今日は活動先がないので、お帰りいただく</button>' +
      '<button class="btn-gray btn-lg" onclick="answerSurplus(2)">② 土砂の量が読めない現場に、必要人数を超えて追加で入ってもらう</button>' +
      '<button class="btn-gray btn-lg" onclick="answerSurplus(3)">③ センターに残ってもらい、資機材の洗浄・受付・翌日の準備を手伝ってもらう</button>' +
    '</div></div>';
}

function answerShort(a) {
  const ok = (a !== 3);
  let d;
  if (a === 1) {
    d = '妥当な判断です。<b>予定人数がそろわなくても送り出すことはあります。</b>' +
        'できるところまで進めて「継続」で記録し、翌日に引き継ぐ。被災された方にとっては、' +
        '半分でも進むほうが、まったく進まないよりずっと助かります。';
  } else if (a === 2) {
    d = 'これも妥当な判断です。中途半端に手をつけると、かえって片づかない現場もあります。' +
        'ただし<b>必ずご本人に連絡してください。</b>「今日来る」と思って待っている方を、' +
        '連絡なしで待たせるのが一番いけません。';
  } else {
    d = '<b>危機介入が必要な現場から人を抜くのは、順番が逆です。</b>' +
        'そこは今日いちばん優先すると決めた現場です。人数が足りないなら、' +
        '足りないまま送り出すか、翌日に回すかを選びます。優先順位を自分で崩さないでください。';
  }
  mark(ok, '人数がそろわない現場の扱いを判断した', d);
  const free = S.vols.filter(v => v.assignedTo == null && v.ins === '加入済み').length;
  modal('<h3>' + (ok ? '✓ その判断はあり得ます' : '順番を確認しましょう') + '</h3><p>' + d + '</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();' +
      (free ? 'showSurplus()' : 'issueDoc()') + '">続ける</button></div>');
}
function showSurplus() {
  const free = S.vols.filter(v => v.assignedTo == null && v.ins === '加入済み').length;
  show(navi('もうひとつ。<b>活動先が決まっていない方</b>の扱いを決めます。') + surplusPanel(free));
}

function answerSurplus(a) {
  const ok = (a !== 1);
  let d;
  if (a === 2) {
    d = '良い判断です。<b>必要人数はあくまで見立てです。</b>' +
        '土砂の量は掘ってみないと分かりません。多めに入ってもらえば早く終わり、' +
        '早く終われば次の現場に回れます。現場で「人が足りない」となってから呼ぶのは間に合いません。';
  } else if (a === 3) {
    d = '良い判断です。災害VCの仕事は現場だけではありません。' +
        '資機材の洗浄、受付の応援、翌日の資機材の仕分け、依頼書の整理。' +
        '<b>やることはいくらでもあります。</b>「今日は来てよかった」と思って帰ってもらえれば、明日も来てくれます。';
  } else {
    d = '<b>それが最初の選択肢になるのはもったいないです。</b>' +
        '必要人数を超えて現場に入ってもらう、センターの作業を手伝ってもらう、' +
        '翌日の予定を聞いておく。まず考えることがあります。<br>' +
        '人が集まりすぎて本当に帰っていただく日もありますが、そのときも' +
        '<b>「明日も来てもらえますか」と必ず聞いてください。</b>黙って帰した方は、もう来ません。';
  }
  mark(ok, '活動先が決まらなかった方への対応を考えた', d);
  modal('<h3>' + (ok ? '✓ その対応はあり得ます' : 'もう一歩考えましょう') + '</h3><p>' + d + '</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();issueDoc()">活動依頼書を発行する</button></div>');
}

function toggleVol(i) {
  const v = S.vols[i];
  if (selNeed == null) return;
  if (v.assignedTo != null && v.assignedTo !== selNeed) return;   // 他の現場に割当済み
  if (v.assignedTo === selNeed) { v.assignedTo = null; drawMatching(); return; }
  if (v.ins !== '加入済み') {
    v.insTried = true;
    modal('<h3>⚠ ' + esc(CONFIG.INSURANCE_NAME) + 'が未加入です</h3>' +
      '<p>' + esc(v.name) + 'さんは、' + esc(CONFIG.INSURANCE_NAME) + 'に加入していません。<br>' +
      'けがや事故が起きたときに補償が受けられないため、<b>このまま現場へ送り出すことはできません</b>。</p>' +
      '<p class="muted">「人数が足りないから」で送り出してしまうと、ボランティアも社協も守れません。' +
      'ただし、断って帰ってもらうのではなく、<b>その場で加入につなぐ</b>のが受付の仕事です。</p>' +
      (CONFIG.ONLINE_INSURANCE
        ? '<div class="panel" style="margin:0;background:#e8f4fb;border-color:#b7d9ee">' +
          '<p style="margin:0;font-size:1rem">' + esc(CONFIG.INSURANCE_NAME) + 'は通常、市区町村社協の窓口で加入しますが、' +
          '<b>災害時には特例としてオンラインで加入できる場合があります</b>。' +
          'スマホからその場で手続きしてもらえば、今日から活動できます。</p></div>' +
          '<div class="btnrow end"><button class="btn-gray" onclick="closeModal()">今回は見送る</button>' +
          '<button class="btn-orange" onclick="joinInsurance(' + i + ')">オンライン加入を案内する</button></div>'
        : '<div class="btnrow end"><button class="btn-gray" onclick="closeModal()">今回は見送る</button>' +
          '<button class="btn-orange" onclick="joinInsurance(' + i + ')">窓口で加入手続きをしてもらう</button></div>'));
    return;
  }
  v.assignedTo = selNeed;      // 必要人数を超えて入れることもできます（現場の判断）
  drawMatching();
}

/* 未加入の方を、その場で保険加入につなぐ */
function joinInsurance(i) {
  const v = S.vols[i];
  const online = CONFIG.ONLINE_INSURANCE;
  modal('<h3>' + esc(CONFIG.INSURANCE_NAME) + 'の加入手続き</h3>' +
    '<p class="muted">' + (online
      ? 'スマホで加入ページを開いてもらい、氏名・住所・連絡先を入力してもらいます。'
      : '窓口で加入申込書に記入してもらいます。') + '</p>' +
    '<div class="kin"><div class="kin-body">' +
      '<div class="fld"><label>氏名</label><input type="text" class="readonly" readonly value="' + esc(v.name) + '"></div>' +
      '<div class="fld"><label>住所</label><input type="text" class="readonly" readonly value="' + esc(v.addr || '善通寺市内') + '"></div>' +
      '<div class="fld"><label>連絡先</label><input type="text" class="readonly" readonly value="' + esc(v.tel) + '"></div>' +
      '<div class="fld"><label>加入プラン</label><input type="text" class="readonly" readonly value="天災タイプ（地震・噴火・津波も補償）"></div>' +
    '</div></div>' +
    '<p class="muted">補償期間は毎年4月1日〜翌年3月31日。<b>活動に出発する前</b>に加入が完了している必要があります。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="doneInsurance(' + i + ')">加入手続きを完了する</button></div>');
}
function doneInsurance(i) {
  const v = S.vols[i];
  v.ins = '加入済み';
  v.insJoined = true;
  closeModal();
  drawMatching();
  modal('<h3>✓ 加入が完了しました</h3>' +
    '<p>' + esc(v.name) + 'さんは' + esc(CONFIG.INSURANCE_NAME) + 'に加入済みになりました。' +
    '当日受付アプリの「ボランティア保険の加入の有無」も更新し、活動に参加できます。</p>' +
    '<p class="muted">未加入だからと帰ってもらうと、来てくれた気持ちも、足りていない人手も失います。' +
    '<b>その場で加入につなぐ</b>ところまでが受付の仕事です。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal()">続ける</button></div>');
}

function issueDoc() {
  // 採点
  const crisisNeed = S.needs.find(n => n.crisis);
  if (crisisNeed) {
    const cnt = S.vols.filter(v => v.assignedTo === crisisNeed.id).length;
    const ok = cnt >= crisisNeed.people;
    mark(ok, '危機介入が必要な現場に、必要人数をそろえた',
      ok ? esc(crisisNeed.requester) + 'さんの現場に' + cnt + '名を確保できました（必要 ' + crisisNeed.people + '名）。人が足りない日は、どこから埋めるかを決めるのが仕事です。'
         : esc(crisisNeed.requester) + 'さんは一人暮らしで持病があり、断水で生活が成り立っていません。人が足りない日ほど、<b>ここから埋める</b>のが災害VCの判断です（' + cnt + '/' + crisisNeed.people + '名でした）。');

    if (crisisNeed.equip.indexOf('軽トラック') >= 0) {
      const hasTruck = S.vols.some(v => v.assignedTo === crisisNeed.id && v.truck === 'あり');
      mark(hasTruck, '軽トラックが必要な現場に、車を持つ方を割り当てた',
        hasTruck ? '運び出しまで完結できます。'
                 : '土砂撤去には運び出す車が必要です。人だけ送っても、泥を積んだ土のう袋が現場に残ります。軽トラックをお持ちの方の割り当てを確認しましょう。');
    }
  }
  const joined = S.vols.some(v => v.insJoined);
  const tried  = S.vols.some(v => v.insTried);
  mark(true, '保険未加入の方への対応',
    joined ? '未加入だった方を、その場で' + esc(CONFIG.INSURANCE_NAME) + 'の加入につないで参加してもらえました。' +
             '断って帰ってもらうと、来てくれた気持ちも人手も失います。'
           : tried ? '未加入の方を送り出そうとしましたが、システムが止めました。補償が受けられないため送り出せません。' +
                     'ただし、そこで終わりにせず<b>その場で加入につなぐ</b>と、その方も活動に参加できました。'
                   : '保険の加入状況を確認したうえで割り当てできました。' +
                     '未加入の方がいた場合は、断るのではなくその場で加入につなぎます。');

  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  const members = S.vols.filter(v => v.assignedTo === n.id).map(v => v.name);
  modal(
    '<h3>活動依頼書 兼 報告書</h3>' +
    '<div class="doc"><h4>活 動 依 頼 書</h4><table>' +
      '<tr><td class="h">ニーズID</td><td>' + n.id + '</td></tr>' +
      '<tr><td class="h">依頼者</td><td>' + esc(n.requester) + '　様</td></tr>' +
      '<tr><td class="h">場所</td><td>' + esc(n.addr) + '</td></tr>' +
      '<tr><td class="h">活動内容</td><td>' + esc(n.category.join('・')) + '</td></tr>' +
      '<tr><td class="h">必要資機材</td><td>' + esc(n.equip.join('、')) + '</td></tr>' +
      '<tr><td class="h">活動者</td><td>' + esc(members.join('、') || '（未割当）') + '</td></tr>' +
      '<tr><td class="h">活動報告欄</td><td style="height:52px">（活動後、現場で手書きしてもらいます）</td></tr>' +
    '</table>' +
    '<p style="margin:10px 0 0;font-size:.85rem">※ 右下のQRコードを読むとGoogleマップが開き、そのまま道案内に使えます。</p></div>' +
    '<p class="muted" style="margin-top:10px">これを印刷して渡します。<b>資機材・送出し班</b>は、この紙の「必要資機材」を見て準備します。' +
    'つまり、現地調査班の入力がそのまま紙になって現場へ届きます。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();bump();sceneSendoff()">印刷して渡す</button></div>'
  );
}

/* ============================================================
   8. 資機材・送出し班
   ============================================================ */
function sceneSendoff() {
  setTop('11:40', '資機材準備・送り出し', '資機材・送出し班');
  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  show(
    navi('<b>資機材・送出し班</b>です。この班は<b>kintoneを操作しません</b>。' +
         'マッチング班が印刷した紙の活動依頼書を見て、道具を準備して送り出します。') +
    '<div class="panel">' +
      '<h2>資機材の準備</h2>' +
      '<p class="muted">活動依頼書に書かれた資機材をそろえて、チェックしてください。</p>' +
      n.equip.map(e => '<label style="display:block;padding:8px 0;border-bottom:1px solid var(--line2);cursor:pointer">' +
        '<input type="checkbox" class="eqchk" onchange="checkSendoff()" style="width:18px;height:18px;vertical-align:-3px;margin-right:9px">' +
        esc(e) + '</label>').join('') +
      '<p class="muted" style="margin-top:10px">記載が分からないときは、勝手に判断せずマッチング班に確認します。</p>' +
    '</div>' +
    '<div class="panel">' +
      '<h2>出発前の安全確認</h2>' +
      '<p class="muted">資機材がそろっても、そのまま送り出してはいけません。' +
      '<b>ここでの確認が、けがと事故を防ぎます。</b></p>' +
      CONFIG.SAFETY_CHECK.map(s => '<label style="display:block;padding:8px 0;border-bottom:1px solid var(--line2);cursor:pointer">' +
        '<input type="checkbox" class="safechk" onchange="checkSendoff()" style="width:18px;height:18px;vertical-align:-3px;margin-right:9px">' +
        esc(s) + '</label>').join('') +
      '<button class="btn btn-lg" id="sendBtn" style="margin-top:16px" disabled onclick="doSendoff()">ボランティアを送り出す</button>' +
      '<p class="muted" id="sendHint" style="margin-top:10px">資機材と安全確認の両方がそろうと、送り出せます。</p>' +
    '</div>'
  );
}
function checkSendoff() {
  const all = $$('.eqchk').every(c => c.checked) && $$('.safechk').every(c => c.checked);
  $('#sendBtn').disabled = !all;
}
function doSendoff() {
  mark(true, '出発前に、体調と装備を確認してから送り出した',
    '体調・装備・水分・「無理をしない」の声かけ・連絡先。この5つを確認してから送り出します。' +
    '一度出発してしまうと、現場では確認できません。');
  bump();
  sceneEvent();
}

/* ============================================================
   9. イベント（二度目の電話 ＝ 二重登録の罠）
   ============================================================ */
function sceneEvent() {
  setTop(CONFIG.TIMES.event, '午後', 'ニーズ班');
  const n = S.needs[0];
  show(
    navi('午後になりました。ボランティアは現場で活動しています。<br>そこへ、また電話が鳴りました。') +
    '<div class="phone">' + pSil('manM') +
      '<div class="ring">☎ 13:30  電話が鳴っています</div>' +
      '<p class="line">「善通寺町の田中の息子です。母から連絡がありまして。」</p>' +
      '<p class="line">「家に泥が入って、一人では動かせんと言うとるんです。」</p>' +
      '<p class="line">「どなたか手伝うてもらえんでしょうか。」</p>' +
      '<div class="who">田中ハルヱさんのご家族から</div>' +
    '</div>' +
    '<div class="panel">' +
      '<h2>どうしますか？</h2>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerEvent(1)">① 新しいニーズとして登録する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerEvent(2)">② 名簿とニーズ管理を検索し、同じ依頼がないか確認する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerEvent(3)">③ 折り返しますと伝えて、いったん切る</button>' +
      '</div>' +
    '</div>'
  );
}
function answerEvent(a) {
  const n = S.needs[0];
  let ok = false, title = '同じ依頼の二重登録を避けた', detail = '';
  if (a === 1) {
    detail = '<b>二重登録が起きました。</b>ニーズID ' + n.id + ' と同じ内容のレコードがもう1件できてしまいます。' +
      'こうなると、別の班が同じ現場に二重にボランティアを送ったり、完了したはずのニーズが残り続けたりします。' +
      '災害VCで最も多い記録の事故です。<b>登録の前に、必ず名簿とニーズ管理を検索してください。</b>';
  } else if (a === 2) {
    ok = true;
    detail = '正解です。検索するとニーズID ' + n.id + '（' + esc(n.requester) + 'さん）が見つかり、すでに午前中から活動中だと分かります。' +
      '新規登録ではなく、そのレコードに「ご家族から同内容の連絡あり」と追記して、ご家族には状況をお伝えします。';
  } else {
    detail = '間違いではありませんが、折り返す前に検索していれば、その場で「すでに動いています」と安心してもらえました。' +
      '災害時は、同じ困りごとが本人・家族・近所の方から何度も入ってきます。<b>まず検索</b>が鉄則です。';
  }
  mark(ok, title, detail);
  modal('<h3>' + (ok ? '✓ その対応で正解です' : '確認しましょう') + '</h3><p>' + detail + '</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();bump();sceneReturn()">ボランティアの帰りを待つ</button></div>');
}

/* ============================================================
   10. 活動報告（アクションボタンの罠）
   ============================================================ */
function sceneReport() {
  setTop(CONFIG.TIMES.report, '活動報告', 'マッチング班');
  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  const members = S.vols.filter(v => v.assignedTo === n.id).map(v => v.name);
  show(
    navi('ボランティアが戻ってきました。<b>紙の報告書</b>と<b>口頭の報告</b>を受けて、<b>活動報告アプリ</b>に記録します。<br>' +
         'このとき、<b>開き方</b>に落とし穴があります。') +
    '<div class="phone">' +
      '<div class="ring">15:30  ' + esc(members[0] || 'ボランティア') + 'さんたちが帰ってきました</div>' +
      '<p class="line">「泥はだいたい出せました。土のう袋で20袋ほどです。」</p>' +
      '<p class="line">「ただ、押し入れの奥がまだ濡れとって、今日は手が回りませんでした。」</p>' +
      '<p class="line">「田中さん、水が出んけん洗い物ができんと言うとりました。」</p>' +
      '<div class="who">口頭でしか出てこない情報があります。聞き漏らさず記録します。</div>' +
    '</div>' +
    kin('needs',
      '<div class="fld"><label>ニーズID</label><input type="text" class="readonly" readonly value="' + n.id + '"></div>' +
      '<div class="fld"><label>依頼者</label><input type="text" class="readonly" readonly value="' + esc(n.requester) + '"></div>' +
      '<div class="fld"><label>進捗状況</label><div>' + statusBadge(n.status) + '</div></div>',
      { actions: '<button class="actbtn" onclick="openReport(true)">活動報告</button>' +
                 '<button class="actbtn" style="background:#8fa6ae" onclick="openMapMemo()">ニーズマップ</button>' }) +
    '<div class="panel" style="background:#fff8ee;border-color:#f3ddb5">' +
      '<p style="margin:0">上の<b>オレンジのボタン</b>から活動報告を作ると、ニーズIDが自動で引き継がれ、' +
      'ニーズと報告がひもづきます。<br>' +
      '<span class="muted">活動報告アプリを単体で開いて作ると、ここが空欄のままになり、' +
      'ニーズ管理側から「活動した記録がない」ように見えてしまいます。' +
      '<b>必ずニーズのレコードから始める</b>と覚えてください。</span></p></div>'
  );
}

let reportLinked = true;
function openReport(viaAction) {
  reportLinked = true;
  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  const members = S.vols.filter(v => v.assignedTo === n.id).map(v => v.name);

  const idField =
    '<div class="fld"><label>ニーズID</label><input type="text" class="readonly" readonly value="' + n.id + '" style="background:#fff8ee;border-color:var(--orange)">' +
    '<div class="hint" style="color:var(--orange-d)">↑ ［活動報告］ボタンから開いたので、自動で入りました</div></div>';

  show(
    navi('ニーズIDが自動で引き継がれました。<b>紙の報告書と、口頭で聞いた内容を記録します。</b>') +
    afPanel('活動報告を入力する') +
    kin('report',
      idField +
      '<div class="fld"><label>活動日</label><input type="text" class="readonly" readonly value="' + esc(CONFIG.DAY) + '"></div>' +
      '<div class="fld"><label>報告者</label><input type="text" class="readonly" readonly value="' + esc(members[0] || '') + '"></div>' +
      '<div class="fld"><label>活動人数</label><input type="text" class="readonly" readonly value="' + members.length + '名"></div>' +
      '<div class="fld"><label>報告内容</label><textarea id="i_rep" class="readonly" readonly></textarea></div>' +
      '<div class="fld"><label>進捗状況</label>' + optsHtml('o_prg', ['継続', '完了'], false) + '</div>',
      { plus: true })
  );
  $('#afStart').onclick = () => afRun(reportSteps(), '活動報告アプリに保存しました。',
    '保存して次へ', saveReport);
}

function reportSteps() {
  return [
    { sel: '#i_rep', type: 'text', src: 'talk',
      value: '土砂の撤去を行い、土のう袋20袋を搬出。押し入れの奥がまだ濡れており、本日は未着手。ご本人は断水で洗い物ができないと話されていた。',
      label: '報告内容',
      say: '<b>紙の報告書に書かれていることだけでは足りません。</b>' +
           '「押し入れの奥がまだ濡れている」「断水で洗い物ができない」は、口頭でしか出てこなかった話です。<br>' +
           '<b>聞いたその場で書き残さないと、消えます。</b>これが翌日の判断と、完了後の見守りにつながります。',
      pause: 1000 },
    { sel: '#o_prg', type: 'opt', value: '完了', src: 'talk',
      label: '進捗状況：完了',
      say: '土砂の撤去という依頼そのものは終わったので「完了」にします。' +
           '（作業が残っているときは「継続」にして、翌日へ申し送ります）' }
  ];
}

function saveReport() {
  const t = $('#i_rep').value.trim();
  const prg = pick1('o_prg') || '完了';
  S.reports.push({ needId: S.needs[0].id, text: t, prg: prg });

  if (prg === '完了') {
    modal('<h3>活動報告を「完了」で保存しました</h3>' +
      '<p>ニーズ管理アプリ側の<b>進捗状況</b>は、まだ「活動中」のままです。<br>どうしますか？</p>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn btn-lg" onclick="finishReport(true)">ニーズ管理側も「完了」に変更する</button>' +
        '<button class="btn-gray btn-lg" onclick="finishReport(false)">このままにする（あとで誰かが直す）</button>' +
      '</div>');
  } else {
    mark(true, '「継続」として、翌日に申し送りした',
      '押し入れの奥が残っているので「継続」は妥当な判断です。翌日、同じニーズIDに続きの活動報告が積み上がっていきます。');
    finishReport(null);
  }
}

function finishReport(sync) {
  closeModal();
  const n = S.needs[0];
  if (sync === true) {
    n.status = '完了';
    mark(true, '完了時に、ニーズ管理側の進捗状況も「完了」にした',
      '2つのアプリの状態がそろいました。ここがずれると、完了したはずの現場に翌日また人が送られます。');
  } else if (sync === false) {
    mark(false, '完了時に、ニーズ管理側の進捗状況も「完了」にした',
      'ニーズ管理側が「活動中」のまま残りました。翌朝、マッチング班はこのニーズをまだ終わっていないと判断し、<b>同じ現場にもう一度ボランティアを送ってしまいます</b>。活動報告を「完了」にしたら、ニーズ管理側も必ず変更してください。');
  }
  bump();
  sceneCerts();
}

/* ============================================================
   10-2. 活動後の手続き（活動証明書／高速道路通行証明書）
   ============================================================ */
function certVol() {
  const n = S.needs.find(x => S.vols.some(v => v.assignedTo === x.id)) || S.needs[0];
  return S.vols.find(v => v.assignedTo === n.id) || S.vols[0];
}

function sceneCerts() {
  const v = certVol();
  setTop('16:30', '活動後の手続き', 'マッチング班');
  show(
    navi('活動報告のあと、ボランティアから<b>手続きの相談</b>を受けることがあります。<br>' +
         'これもマッチング班の仕事です。') +
    '<div class="phone">' + pSil('volun') +
      '<div class="ring">16:30  受付に' + esc(v.name) + 'さんが来られました</div>' +
      '<p class="line">「あの、学校に提出する<b>活動の証明書</b>をいただけますか。」</p>' +
      '<p class="line">「あと、高速道路が無料になると聞いたんですが、そちらもお願いできますか。」</p>' +
      '<div class="who">2つの手続きを頼まれました</div>' +
    '</div>' +
    '<div class="panel"><p>まず<b>活動証明書</b>から発行します。使うアプリは「災害VC活動証明書」です。</p>' +
    '<button class="btn btn-lg" onclick="certForm()">活動証明書アプリを開く</button></div>'
  );
}

let certOK = false;
function certForm() {
  certOK = true;
  const v = certVol();
  const body =
    '<div class="fld"><label>氏名</label><input type="text" id="i_cn" class="readonly" readonly></div>' +
    '<div class="fld"><label>電話番号</label><input type="text" id="i_ctel" class="readonly" readonly></div>' +
    '<div class="fld"><label>住所</label><input type="text" id="i_cadr" class="readonly" readonly></div>' +
    '<div class="fld"><label>内容（災害名）</label><input type="text" id="i_cnm" class="readonly" readonly></div>' +
    '<div class="fld"><label>活動開始日</label><input type="text" id="i_cs" class="readonly" readonly></div>' +
    '<div class="fld"><label>活動終了日</label><input type="text" id="i_ce" class="readonly" readonly></div>' +
    '<div class="fld"><label>活動期間</label><input type="text" id="i_cp" class="readonly" readonly></div>';
  show(
    navi('<b>活動証明アプリ</b>で発行します。氏名から<b>当日受付アプリ</b>を検索すると、連絡先が自動で入ります。<br>' +
         '<span class="muted">当日受付アプリがボランティア名簿を兼ねているので、ここから引けます。</span>') +
    afPanel('活動証明書を入力する') +
    kin('cert', body, { plus: true })
  );
  $('#afStart').onclick = () => afRun(certSteps(v), '活動証明書の内容がそろいました。',
    '活動証明書を発行する', certIssue);
}

function certSteps(v) {
  return [
    { sel: '#i_cn', type: 'text', value: v.name, src: 'recept',
      label: '氏名：' + v.name,
      say: '氏名で当日受付アプリを検索します。' },
    { sel: '#i_ctel', type: 'text', value: v.tel, src: 'recept',
      label: '電話番号',
      say: '当日受付アプリから自動で入りました。<b>朝、QRコードで受付したときの情報</b>がここまでつながっています。' },
    { sel: '#i_cadr', type: 'text', value: v.addr || '善通寺市内', src: 'recept',
      label: '住所', say: '同じく当日受付アプリから入りました。' },
    { sel: '#i_cnm', type: 'text', value: CONFIG.DISASTER, src: 'auto',
      label: '内容（災害名）', say: '証明書に載る災害名です。' },
    { sel: '#i_cs', type: 'text', value: CONFIG.DAY, src: 'auto', label: '活動開始日' },
    { sel: '#i_ce', type: 'text', value: CONFIG.DAY, src: 'auto', label: '活動終了日' },
    { sel: '#i_cp', type: 'text', value: '1日間', src: 'auto',
      label: '活動期間：1日間',
      say: '開始日と終了日から<b>自動で計算</b>されます。手で数える必要はありません。', pause: 850 }
  ];
}

function certIssue() {
  mark(true, '活動証明書を、当日受付アプリから呼び出して発行した',
    '当日受付アプリがボランティア名簿を兼ねているので、氏名から連絡先を引けます。' +
    '手入力すると表記ゆれが起き、同じ人が別人として何件も並ぶことになります。');
  modal('<h3>活動証明書</h3>' +
    '<div class="doc"><h4>活 動 証 明 書</h4><table>' +
      '<tr><td class="h">氏名</td><td>' + esc($('#i_cn').value) + '　様</td></tr>' +
      '<tr><td class="h">住所</td><td>' + esc($('#i_cadr').value) + '</td></tr>' +
      '<tr><td class="h">内容</td><td>' + esc(CONFIG.DISASTER) + 'に係る災害ボランティア活動</td></tr>' +
      '<tr><td class="h">活動期間</td><td>' + esc(CONFIG.DAY) + '（1日間）</td></tr>' +
      '<tr><td class="h">活動場所</td><td>善通寺市内</td></tr>' +
    '</table>' +
    '<p style="text-align:right;margin:12px 0 0">' + esc(CONFIG.CENTER) + '　　㊞</p></div>' +
    '<p class="muted" style="margin-top:10px">印刷して<b>公印</b>を押し、ボランティアにお渡しします。' +
    '発行すると「印刷」のチェックボックスは自動で「済」になります。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();sceneRoadCert()">印刷して渡す</button></div>');
}

/* 高速道路通行証明書 … 発行するのはVCではありません */
function sceneRoadCert() {
  const v = certVol();
  setTop('16:45', '活動後の手続き', 'マッチング班');
  show(
    navi('もうひとつ、<b>高速道路の無料措置</b>を頼まれました。<br>' +
         'これは災害VCの役割を取り違えやすいところです。よく考えて選んでください。') +
    '<div class="phone">' +
      '<div class="ring">' + esc(v.name) + 'さんからの相談</div>' +
      '<p class="line">「県外から車で来たので、高速代が無料になると聞きました。」</p>' +
      '<p class="line">「証明書はこちらで出してもらえるんでしょうか。」</p>' +
    '</div>' +
    '<div class="panel"><h2>どう説明しますか？</h2>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerRoad(1)">① 災害VCが発行する書類なので、こちらで作って渡す</button>' +
        '<button class="btn-gray btn-lg" onclick="answerRoad(2)">② 原則はご自身で発行サイトから申請・印刷していただき、災害VCは活動したことを確認して押印する</button>' +
        '<button class="btn-gray btn-lg" onclick="answerRoad(3)">③ 災害VCは関わらない手続きなので、すべてご自身でしていただく</button>' +
      '</div>' +
    '</div>'
  );
}
function answerRoad(a) {
  const ok = (a === 2);
  let d;
  if (ok) {
    d = '正解です。<b>' + esc(CONFIG.CERT_ROAD_NAME) + 'は、原則としてボランティア本人が発行サイトで必要事項を入力し、A4サイズで印刷して持参します。</b>' +
        '災害VC・社協の役割は、その用紙に<b>活動したことを確認して押印する</b>ことです。' +
        '高速道路を利用するときは、この証明書と<b>顔写真付きの本人確認書類（運転免許証など）</b>を提示してもらいます。';
  } else if (a === 1) {
    d = '<b>災害VCが最初から作る書類ではありません。</b>原則は、ボランティア本人が発行サイトで申請し、自分で印刷して持参します。' +
        '災害VCの役割は、その用紙への<b>活動確認印の押印</b>です。まず原則を伝えられるようにしておきましょう。';
  } else {
    d = '<b>災害VCは無関係ではありません。</b>申請と印刷はご本人ですが、その用紙に<b>活動確認印を押すのは災害VC・社協</b>です。' +
        'この印がないと無料措置は受けられません。「うちでは扱っていません」と突き放してしまうと、' +
        'ボランティアは押印をもらえないまま帰ることになります。';
  }
  mark(ok, '高速道路の無料措置の原則を、正しく説明できた', d);
  modal('<h3>' + (ok ? '✓ その説明で正解です' : '原則を確認しましょう') + '</h3><p>' + d + '</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();roadTrouble()">続けて対応する</button></div>');
}

/* 原則どおりにできない方が必ず出てきます。そこからが災害VCの仕事 */
function roadTrouble() {
  const v = certVol();
  show(
    navi('原則は伝えました。ですが、<b>原則どおりにできない方が必ずいます。</b><br>' +
         'ここからの対応が、災害VCの窓口の仕事です。') +
    '<div class="phone">' + pSil('volun') +
      '<div class="ring">' + esc(v.name) + 'さんから</div>' +
      '<p class="line">「すみません、スマホの操作が苦手で…。」</p>' +
      '<p class="line">「家にプリンターもないので、印刷して持ってくるのが難しくて。」</p>' +
      '<p class="line">「今日は諦めて、高速代は自分で払って帰ります。」</p>' +
    '</div>' +
    '<div class="panel"><h2>どうしますか？</h2>' +
      '<div class="btnrow" style="flex-direction:column">' +
        '<button class="btn-gray btn-lg" onclick="answerRoadHelp(1)">① 原則なので、ご自身で手続きしていただくようお願いする</button>' +
        '<button class="btn-gray btn-lg" onclick="answerRoadHelp(2)">② 災害VCのパソコンで代わりに申請・印刷し、活動確認印を押して渡す</button>' +
        '<button class="btn-gray btn-lg" onclick="answerRoadHelp(3)">③ 次回までにご自身で用意してきてくださいと伝える</button>' +
      '</div>' +
    '</div>'
  );
}
function answerRoadHelp(a) {
  const ok = (a === 2);
  let d;
  if (ok) {
    d = '正解です。<b>原則は本人申請ですが、スマホやプリンターが使えない方、印刷を忘れた方には、災害VCが代行して申請・印刷することがあります。</b>' +
        '当日受付アプリに氏名・住所・連絡先が入っているので、それを見ながら入力できます。印刷したら活動確認印を押してお渡しします。' +
        '「原則はこうです」で終わらせず、<b>できない人の分をこちらが引き受ける</b>。当日受付でスマホが苦手な方の代行入力をしたのと、同じ考え方です。';
  } else if (a === 1) {
    d = '原則は正しいのですが、それでは<b>この方は高速代を自己負担して帰ることになります</b>。' +
        '遠方から来てくれた方ほど負担が大きく、次に来てもらえなくなります。' +
        'スマホやプリンターが使えない方には、災害VCのパソコンで<b>代行して申請・印刷する</b>ことができます。';
  } else {
    d = '次回があるとは限りません。今日活動してくださった分の無料措置は、今日のうちに手続きします。' +
        'スマホやプリンターが使えない方には、災害VCが<b>代行して申請・印刷する</b>ことができます。';
  }
  mark(ok, '自分で手続きできない方の分を、災害VCが代行した', d);
  modal('<h3>' + (ok ? '✓ その対応で正解です' : '確認しましょう') + '</h3><p>' + d + '</p>' +
    '<p class="muted">※ 無料措置の対象範囲・手続きは災害ごとに国土交通省・NEXCOから示されます。' +
    '実際の災害時は、その時点の案内を必ず確認してください。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal();bump();sceneResult()">1日を終える</button></div>');
}

/* ============================================================
   11. ふりかえり
   ============================================================ */
function sceneResult() {
  setTop(CONFIG.TIMES.result, '本日終了', 'ふりかえり');
  $('#progressbar').style.width = '100%';
  const ok = S.review.filter(r => r.ok).length;
  const total = S.review.length || 1;
  const score = Math.round(ok / total * 100);
  const comment =
    score >= 90 ? '流れも判断も、しっかりつかめています。次は本番のkintoneで同じ手順をやってみましょう。' :
    score >= 70 ? '大きな流れはつかめています。×がついた項目だけ、もう一度読んでおいてください。' :
    score >= 40 ? '流れは体験できました。×の項目は、実際の災害VCでよく起きる失敗です。もう一度やってみましょう。' :
                  'まずは1日の流れを体験できたことが第一歩です。解説を読んで、もう一度やってみましょう。';

  show(
    '<div class="panel center">' +
      '<p class="muted" style="margin:0">本日の運営のふりかえり</p>' +
      '<div class="score">' + score + '</div>' +
      '<p class="muted">' + ok + ' / ' + total + ' 項目</p>' +
      '<p style="text-align:left">' + comment + '</p>' +
      '<p class="muted" style="text-align:left;font-size:.88rem">※ この点数は<b>運営の手順</b>についてのものです。' +
      '実際の災害では、対応できた件数の多さで良し悪しが決まるわけではありません。</p>' +
    '</div>' +
    '<div class="panel">' +
      '<h2>今日おさえたこと</h2>' +
      S.review.map(r =>
        '<div class="rev ' + (r.ok ? 'ok' : 'ng') + '">' +
          '<div class="rt">' + (r.ok ? '○ ' : '× ') + esc(r.title) + '</div>' +
          '<div class="rd">' + r.detail + '</div>' +
        '</div>').join('') +
    '</div>' +
    '<div class="panel">' +
      '<h2>今日たどった流れ</h2>' +
      '<p style="font-size:1rem">①ニーズ受付（ニーズ班）→ ②現地調査（現地調査班）→ ③当日受付（当日受付班）→ ' +
      '④オリエン・マッチング（マッチング班）→ ⑤資機材準備・送り出し（資機材・送出し班）→ ' +
      '⑥ボランティア活動 → ⑦活動報告（マッチング班）</p>' +
      '<p class="muted">この7つの工程を、6つのアプリでつないでいるのが災害VCのシステムです。' +
      '<b>あなたの入力は、必ず次の班の判断材料になります。</b>それが今日いちばん覚えて帰ってほしいことです。</p>' +
    '</div>' +
    '<div class="panel center">' +
      '<button class="btn btn-lg" onclick="restart()">もう一度やってみる</button>' +
      '<p class="muted" style="margin-top:12px">次のステップ：実際のkintoneを開いて、同じ手順をやってみましょう。' +
      '操作の詳しい手順は「災害VC kintone操作マニュアル」にあります。</p>' +
    '</div>'
  );
}

function restart() {
  S.roster = CONFIG.ROSTER.map(r => Object.assign({}, r));
  S.needs = []; S.vols = []; S.reports = []; S.review = []; S.step = 0;
  S.sheet = { fields: {}, memo: [], asked: [], ended: false, judge: {} };
  S.flags = {};
  arrivalsStarted = false;
  if (typeof NAV !== 'undefined') { NAV.stack = []; updateBackBtn(); }
  sceneTitle();
}

/* 災害地図メモ（全班共通・いつでも） */
function openMapMemo() {
  modal('<h3>災害地図メモ</h3>' +
    '<p>ニーズマップ上に、現地で気づいたことを登録して全班で共有します。' +
    '「この道は通行止め」「入口は裏から」など、<b>気づいた人が随時</b>登録します。</p>' +
    '<div class="panel" style="margin:0;background:#f6f8f8">' +
      '<p style="margin:0;font-size:1rem">📍 善通寺町1丁目　<b>通行止め</b>（土砂で車が通れません）<br>' +
      '<span class="muted">現地調査班が登録／10:25</span></p></div>' +
    '<p class="muted" style="margin-top:10px">ハザード情報（洪水浸水想定・土砂災害）を重ねて表示することもできます。' +
    '危険な区域を避けて活動計画を立てるために使います。</p>' +
    '<div class="btnrow end"><button class="btn" onclick="closeModal()">閉じる</button></div>');
}

/* ============================================================
   画面の履歴（← もどる）
   ------------------------------------------------------------
   各シーンに入る直前の状態を控えておき、「もどる」で復元します。
   下の SCENES_WITH_HISTORY に名前を並べたシーンが対象です。
   ============================================================ */
const NAV = { stack: [], lock: false };

function snapshot() {
  return JSON.stringify({
    S: S,
    certOK: certOK, selNeed: selNeed, reportLinked: reportLinked
  });
}
function restoreSnap(str) {
  const o = JSON.parse(str);
  Object.keys(S).forEach(k => { delete S[k]; });
  Object.keys(o.S).forEach(k => { S[k] = o.S[k]; });
  certOK = o.certOK; selNeed = o.selNeed; reportLinked = o.reportLinked;
}
function remember(fn, args) {
  if (NAV.lock) return;
  NAV.stack.push({ fn: fn, args: args, snap: snapshot() });
  updateBackBtn();
}
function goBack() {
  if (NAV.stack.length < 2) return;
  closeModal();
  NAV.stack.pop();
  const prev = NAV.stack[NAV.stack.length - 1];
  restoreSnap(prev.snap);
  NAV.lock = true;
  try { window[prev.fn].apply(null, prev.args); } finally { NAV.lock = false; }
  updateBackBtn();
}
function updateBackBtn() {
  const b = document.getElementById('backbtn');
  if (b) b.disabled = NAV.stack.length < 2;
}

/* 対象のシーンを包んで、入るたびに状態を控える */
const SCENES_WITH_HISTORY = [
  'sceneIntro', 'scenePortal', 'sceneCall', 'sceneIntake', 'sceneEscalate', 'needsForm',
  'sceneSurveyIntro', 'sceneAskChief', 'sceneSurveyBrief', 'sceneSurvey', 'sceneRecept', 'sceneOrientation',
  'sceneMatching', 'sceneMatchReview', 'sceneSendoff', 'sceneEvent', 'sceneReturn',
  'sceneReport', 'openReport', 'sceneCerts', 'certForm', 'sceneRoadCert', 'roadTrouble', 'sceneResult'
];
SCENES_WITH_HISTORY.forEach(function (name) {
  const orig = window[name];
  if (typeof orig !== 'function') return;
  window[name] = function () {
    remember(name, [].slice.call(arguments));
    return orig.apply(null, arguments);
  };
});

/* ============================================================
   文字サイズの切り替え（標準／大／特大）
   ------------------------------------------------------------
   年代によって読みやすい大きさが違うので、その場で変えられます。
   選んだ大きさは次に開いたときも引き継がれます。
   ============================================================ */
const TEXT_SIZES = [{ c: '', n: '標準' }, { c: 'big', n: '大' }, { c: 'xbig', n: '特大' }];
let textSizeIdx = 0;

function applyTextSize() {
  const t = TEXT_SIZES[textSizeIdx];
  document.documentElement.classList.remove('big', 'xbig');
  if (t.c) document.documentElement.classList.add(t.c);
  const b = document.getElementById('sizebtn');
  if (b) b.textContent = '文字 ' + t.n;
  try { localStorage.setItem('vcTextSize', String(textSizeIdx)); } catch (e) {}
}
function cycleTextSize() {
  textSizeIdx = (textSizeIdx + 1) % TEXT_SIZES.length;
  applyTextSize();
}
try {
  const saved = localStorage.getItem('vcTextSize');
  if (saved !== null && TEXT_SIZES[Number(saved)]) textSizeIdx = Number(saved);
} catch (e) {}
applyTextSize();

/* ---------- 起動 ---------- */
restart();
