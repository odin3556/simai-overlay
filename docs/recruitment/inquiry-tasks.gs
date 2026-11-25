/**
 * 「Chrome拡張機能 お問い合わせフォーム（回答）」用 修正タスク管理スクリプト
 *
 * このスプレッドシートの「拡張機能 > Apps Script」に貼り付けて使う（スプレッドシートに付いたスクリプト）。
 *   1. 貼り付けて保存し、関数 setup を1回実行（権限の確認が出たら許可）
 *   2. 以後、「何についてのお問い合わせですか？」がバグ報告の回答が届くと、修正タスクに BUG-xxx が増える
 *   3. バグ以外の回答は「フォームの回答 1」で行を選んで、メニュー「タスク管理 > 選んだ行をタスクにする」
 *   4. 修正タスクのステータスを「完了」にすると完了日が入る
 */

// ===== 設定（フォームの質問名・シート名を変えたらここも直す） =====
const RESPONSE_SHEET = 'フォームの回答 1';
const TASK_SHEET = '修正タスク';
const Q_KIND = '何についてのお問い合わせですか？';
const Q_CONTENT = 'お問い合わせ内容';
const Q_REPORTER = 'Discord ユーザー名';
const Q_TIMESTAMP = 'タイムスタンプ';
const RES_COL_TASK = 'タスクID';
const isBug = kind => /バグ|不具合/.test(String(kind));

const TASK_STATUS = ['未着手', '対応中', '確認待ち', '完了', '保留', '対応しない'];
const TASK_PRIORITY = ['高', '中', '低'];
const TASK_HEADERS = [
  'タスクID', 'ステータス', '優先度', 'タイトル', '種類', '関係する機能', '内容', '動画・曲',
  '報告バージョン', '報告者', '担当', '修正バージョン', '対応メモ', '起票日', '完了日', '元の報告',
];

// ===== 最初に1回だけ実行 =====
function setup() {
  const ss = SpreadsheetApp.getActive();
  const res = ss.getSheetByName(RESPONSE_SHEET);
  if (!res) throw new Error(`シート「${RESPONSE_SHEET}」がありません。`);
  if (headerMap_(res)[RES_COL_TASK] === undefined) {
    res.getRange(1, res.getLastColumn() + 1).setValue(RES_COL_TASK).setFontWeight('bold').setBackground('#fff2cc');
  }

  let tasks = ss.getSheetByName(TASK_SHEET);
  if (!tasks) {
    tasks = ss.insertSheet(TASK_SHEET);
    tasks.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
  }
  formatTaskSheet_(tasks);
  fillResponseTaskIds_(tasks, res);
  linkSourceCells_(tasks, res);

  // フォーム送信だけはインストール型トリガーが必要（onEdit / onOpen は下の関数名のままで動く）
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onResponseSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onResponseSubmit').forSpreadsheet(ss).onFormSubmit().create();

  notify_('修正タスクの準備ができました。シートを再読み込みすると「タスク管理」メニューが出ます。');
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('タスク管理')
    .addItem('選んだ行をタスクにする（フォームの回答で）', 'createTasksFromSelection')
    .addItem('修正タスクの書式を整え直す', 'reformat')
    .addToUi();
}

// フォームの回答が届いたとき。バグ報告ならタスクにする
function onResponseSubmit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== RESPONSE_SHEET) return;
  const row = e.range.getRow();
  const col = headerMap_(sheet);
  if (col[Q_KIND] === undefined) return;
  if (isBug(sheet.getRange(row, col[Q_KIND] + 1).getValue())) createTaskFromRow_(row);
}

function createTasksFromSelection() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== RESPONSE_SHEET) {
    notify_(`「${RESPONSE_SHEET}」シートで、タスクにしたい行を選んでから実行してください。`);
    return;
  }
  const rows = new Set();
  sheet.getActiveRangeList().getRanges().forEach(r => {
    for (let i = Math.max(r.getRow(), 2); i <= r.getLastRow(); i++) rows.add(i);
  });
  const created = [...rows].sort((a, b) => a - b).map(createTaskFromRow_).filter(Boolean);
  notify_(created.length
    ? `タスクにしました: ${created.join(', ')}`
    : '新しく作ったタスクはありません（選んだ行はもうタスクIDがあるか、空です）。');
}

function reformat() {
  formatTaskSheet_(SpreadsheetApp.getActive().getSheetByName(TASK_SHEET));
}

// 修正タスクのステータスを「完了」にしたら完了日を入れる。完了以外に戻したら消す
function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== TASK_SHEET) return;
  const tc = headerMap_(sheet);
  if (tc['ステータス'] === undefined || tc['完了日'] === undefined) return;
  const statusCol = tc['ステータス'] + 1;
  if (e.range.getColumn() > statusCol || e.range.getLastColumn() < statusCol) return;
  for (let r = Math.max(e.range.getRow(), 2); r <= e.range.getLastRow(); r++) {
    const status = sheet.getRange(r, statusCol).getValue();
    const done = sheet.getRange(r, tc['完了日'] + 1);
    if (status === '完了') { if (!done.getValue()) done.setValue(new Date()); }
    else if (done.getValue()) done.clearContent();
  }
}

// ===== 内部 =====
// フォームの回答の row 行目からタスクを1つ作り、タスクIDを返す（もうタスクIDがある・空の行なら null）
function createTaskFromRow_(row) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActive();
    const res = ss.getSheetByName(RESPONSE_SHEET);
    const tasks = ss.getSheetByName(TASK_SHEET);
    if (!tasks) throw new Error('先に setup を実行してください。');
    const rc = headerMap_(res);
    if (rc[RES_COL_TASK] === undefined) throw new Error('先に setup を実行してください。');
    const values = res.getRange(row, 1, 1, res.getLastColumn()).getValues()[0];
    const v = h => (rc[h] === undefined ? '' : values[rc[h]]);
    const content = String(v(Q_CONTENT)).trim();
    if (v(RES_COL_TASK) || !content) return null;

    const kind = String(v(Q_KIND));
    const id = nextTaskId_(tasks, isBug(kind) ? 'BUG' : 'REQ');
    const text = s => (typeof s === 'string' && /^[=+\-@]/.test(s) ? "'" + s : s);
    // フォームにタイトルの質問がないので、内容の1行目を短くしてタイトルにする
    const firstLine = content.split(/\r?\n/).map(s => s.replace(/^[・\s]+/, '')).find(Boolean) || content;
    const title = firstLine.length > 40 ? firstLine.slice(0, 39) + '…' : firstLine;
    const url = (content.match(/https?:\/\/\S+/) || [''])[0];

    const tc = headerMap_(tasks);
    const out = new Array(tasks.getLastColumn()).fill('');
    const set = (h, val) => { if (tc[h] !== undefined) out[tc[h]] = val; };
    set('タスクID', id);
    set('ステータス', '未着手');
    set('優先度', '中');
    set('タイトル', text(title));
    set('種類', text(kind));
    set('内容', text(content));
    set('動画・曲', text(url));
    set('報告者', text(String(v(Q_REPORTER))));
    set('起票日', v(Q_TIMESTAMP) || new Date());
    set('元の報告', sourceLink_(res, row));
    tasks.getRange(tasks.getLastRow() + 1, 1, 1, out.length).setValues([out]);

    res.getRange(row, rc[RES_COL_TASK] + 1).setValue(id);
    return id;
  } finally {
    lock.releaseLock();
  }
}

function sourceLink_(res, row) {
  return `=HYPERLINK("#gid=${res.getSheetId()}&range=A${row}","回答 ${row}行目")`;
}

// 手で作ったタスク（元の報告が「回答 3行目」）の番号を、フォームの回答の「タスクID」に書き写す（空のセルだけ）
function fillResponseTaskIds_(tasks, res) {
  const tc = headerMap_(tasks);
  const rc = headerMap_(res);
  if (tc['タスクID'] === undefined || tc['元の報告'] === undefined || tasks.getLastRow() < 2) return;
  const byRow = {};
  tasks.getRange(2, 1, tasks.getLastRow() - 1, tasks.getLastColumn()).getValues().forEach(r => {
    const m = /^回答 (\d+)行目$/.exec(String(r[tc['元の報告']]));
    if (m && r[tc['タスクID']]) (byRow[m[1]] = byRow[m[1]] || []).push(r[tc['タスクID']]);
  });
  Object.keys(byRow).forEach(row => {
    const cell = res.getRange(Number(row), rc[RES_COL_TASK] + 1);
    if (!cell.getValue()) cell.setValue(byRow[row].join(', '));
  });
}

// 「回答 3行目」のような文字だけのセルを、その行へのリンクにする
function linkSourceCells_(tasks, res) {
  const c = headerMap_(tasks)['元の報告'];
  if (c === undefined || tasks.getLastRow() < 2) return;
  const range = tasks.getRange(2, c + 1, tasks.getLastRow() - 1, 1);
  const formulas = range.getFormulas();
  range.getValues().forEach(([val], i) => {
    const m = /^回答 (\d+)行目$/.exec(String(val));
    if (m && !formulas[i][0]) tasks.getRange(i + 2, c + 1).setFormula(sourceLink_(res, Number(m[1])));
  });
}

function formatTaskSheet_(sheet) {
  const tc = headerMap_(sheet);
  const c = name => tc[name] + 1;
  const n = sheet.getLastColumn();
  const rows = sheet.getMaxRows() - 1;
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();

  sheet.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#d9ead3');
  sheet.setFrozenRows(1);
  sheet.getRange(2, c('ステータス'), rows, 1).setDataValidation(list(TASK_STATUS));
  sheet.getRange(2, c('優先度'), rows, 1).setDataValidation(list(TASK_PRIORITY));
  sheet.getRange(2, c('完了日'), rows, 1).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, c('内容'), rows, 1).setWrap(true);
  sheet.getRange(2, 1, rows, n).setVerticalAlignment('top');
  sheet.setColumnWidth(c('タイトル'), 260);
  sheet.setColumnWidth(c('内容'), 360);
  sheet.setColumnWidth(c('動画・曲'), 220);
  sheet.setColumnWidth(c('対応メモ'), 220);

  // 色分け: 優先度「高」で未完了は赤字、対応中は青、確認待ちはオレンジ、完了・対応しないは灰色
  const st = columnLetter_(c('ステータス'));
  const pr = columnLetter_(c('優先度'));
  const all = sheet.getRange(2, 1, rows, n);
  const rule = (formula, range) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([range]);
  sheet.setConditionalFormatRules([
    rule(`=AND($${pr}2="高",$${st}2<>"完了",$${st}2<>"対応しない")`, sheet.getRange(2, c('優先度'), rows, 1))
      .setFontColor('#cc0000').setBold(true).build(),
    rule(`=OR($${st}2="完了",$${st}2="対応しない")`, all).setBackground('#eeeeee').setFontColor('#888888').build(),
    rule(`=$${st}2="対応中"`, all).setBackground('#cfe2f3').build(),
    rule(`=$${st}2="確認待ち"`, all).setBackground('#fce5cd').build(),
  ]);
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), n).createFilter();
}

// BUG-001, BUG-002 … のように、その接頭辞で一番大きい番号 + 1
function nextTaskId_(tasks, prefix) {
  const col = headerMap_(tasks)['タスクID'];
  let max = 0;
  if (col !== undefined && tasks.getLastRow() >= 2) {
    const re = new RegExp(`^${prefix}-(\\d+)$`);
    tasks.getRange(2, col + 1, tasks.getLastRow() - 1, 1).getValues().forEach(([id]) => {
      const m = re.exec(String(id));
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function headerMap_(sheet) {
  const col = {};
  if (sheet.getLastColumn() === 0) return col;
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .forEach((h, i) => { const k = String(h).trim(); if (k && col[k] === undefined) col[k] = i; });
  return col;
}

function columnLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
