/**
 * simai-overlay 共同開発者募集フォーム & 要望フォーム 自動作成スクリプト
 *
 * 使い方（詳しくは README.md）:
 *   1. https://script.google.com で新しいプロジェクトを作り、このファイルの中身を貼り付ける
 *   2. 下の SHARE_FOLDER_ID に共有したい Google ドライブのフォルダ ID を入れる
 *   3. スクリプトプロパティ DISCORD_WEBHOOK_URL に Discord の Webhook URL を入れる → testWebhook で確認
 *   4. createRecruitForm と createRequestForm を実行 → ログに出るフォームURL / シートURL を控える
 *      （回答が送信されるたびに Discord へ通知されます）
 *   5. 管理シートの「ステータス」を「承認」にして、メニュー「共同開発管理 > 承認者にフォルダを共有」
 *   6. 不具合の報告は「要望・不具合一覧」の「修正タスク」シートに自動でタスクになる
 *      （要望フォームを前の版で作った場合は setupTaskManagement を1回実行）
 */

// ===== 設定 =====
const PROJECT_NAME = 'simai-overlay';
// 共有するドライブのフォルダ ID（URL の https://drive.google.com/drive/folders/XXXX の XXXX 部分）
const SHARE_FOLDER_ID = 'ここにフォルダIDを入れる';
// 'editor'（編集者）か 'viewer'（閲覧者）
const SHARE_ROLE = 'editor';

// Discord 通知
// Webhook URL は人に知られると誰でも投稿できてしまうので、コードには書かずスクリプトプロパティに入れる:
//   プロジェクトの設定（歯車）> スクリプト プロパティ
//   DISCORD_WEBHOOK_URL         … 通知先（必須）
//   RECRUIT_WEBHOOK_URL         … 募集の通知だけ別チャンネルにしたいとき（任意）
//   REQUEST_WEBHOOK_URL         … 要望の通知だけ別チャンネルにしたいとき（任意）
// 通知に Gmail アドレスと Discord ユーザーID を含めるか（通知先が管理者だけのチャンネルなら true でもよい）
const NOTIFY_INCLUDE_PRIVATE = false;

// 管理シートに追加する列（見出し名で探すので、列の位置が変わっても動く）
const COL_STATUS = 'ステータス';
const COL_SHARED_AT = 'フォルダ共有日時';
const COL_MEMO = '管理メモ';
const STATUS_VALUES = ['未対応', '承認', '保留', '見送り', '共有済み'];

// フォームの質問見出し（シートの列名にもなる）
const Q_GMAIL = 'Gmail アドレス';
const Q_DISCORD_NAME = 'Discord 表示名';
const Q_DISCORD_USER = 'Discord ユーザー名';
const Q_DISCORD_ID = 'Discord ユーザーID';

// ===== 修正タスク（「要望・不具合一覧」スプレッドシートの別シート） =====
// 不具合の報告が届くと「修正タスク」シートに1行増える。要望は「タスク管理 > 選んだ行をタスクにする」で追加。
const REQUEST_SHEET = '要望一覧';
const TASK_SHEET = '修正タスク';
const Q_VERSION = '使っているバージョン';
const REQ_COL_TASK = 'タスクID';
const TASK_STATUS = ['未着手', '対応中', '確認待ち', '完了', '保留', '対応しない'];
const TASK_PRIORITY = ['高', '中', '低'];
const TASK_HEADERS = [
  'タスクID', 'ステータス', '優先度', 'タイトル', '種類', '関係する機能', '内容', '動画・曲',
  '報告バージョン', '報告者', '担当', '修正バージョン', '対応メモ', '起票日', '完了日', '元の報告',
];
const PRIORITY_FROM_FORM = { 'すぐ直してほしい': '高', 'あると嬉しい': '中', 'いつでもいい': '低' };
// タスクのステータスを変えたら、要望一覧の「対応状況」もこれに合わせる
const REQUEST_STATUS_FROM_TASK = {
  '未着手': '未着手', '対応中': '対応中', '確認待ち': '対応中', '完了': '完了', '保留': '検討中', '対応しない': '対応しない',
};

// ===== 募集フォーム =====
function createRecruitForm() {
  const form = FormApp.create(`${PROJECT_NAME} 共同開発メンバー募集`);
  form.setDescription([
    'maimai の譜面（simai）を YouTube 動画に重ねて確認する Chrome 拡張「simai-overlay」の共同開発メンバー・テスター募集フォームです。',
    '',
    '・開発用フォルダは Google ドライブで共有します。共有先は下で入力いただく Gmail アドレスです。',
    '・連絡は Discord で行います。Discord の名前と ID を正確に入力してください。',
    '・入力内容は開発メンバーの管理と連絡にのみ使い、第三者には公開しません。',
  ].join('\n'));
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage('ご応募ありがとうございます！ 確認後、Discord でご連絡します。');

  // --- セクション1: 連絡先 ---
  form.addSectionHeaderItem()
    .setTitle('連絡先')
    .setHelpText('フォルダ共有と Discord での連絡に使います。');

  form.addTextItem()
    .setTitle(Q_GMAIL)
    .setHelpText('開発フォルダ（Google ドライブ）をこのアドレスに共有します。@gmail.com のアドレスのみ受け付けます。')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .requireTextMatchesPattern('^[A-Za-z0-9._%+\\-]+@gmail\\.com$')
      .setHelpText('@gmail.com のアドレスを入力してください')
      .build());

  form.addTextItem()
    .setTitle(Q_DISCORD_NAME)
    .setHelpText('サーバーで表示されている名前（例: しんぺい）')
    .setRequired(true);

  form.addTextItem()
    .setTitle(Q_DISCORD_USER)
    .setHelpText('@ の後ろの英数字の名前（例: shinpei_0123）。プロフィールで確認できます。')
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .requireTextMatchesPattern('^@?[a-z0-9_.]{2,32}$')
      .setHelpText('英小文字・数字・_ . のみ、2〜32文字です')
      .build());

  form.addTextItem()
    .setTitle(Q_DISCORD_ID)
    .setHelpText([
      '17〜20桁の数字です。調べ方:',
      '① Discord の「ユーザー設定 > 詳細設定」で「開発者モード」をオン',
      '② 自分のアイコンを右クリック（スマホは長押し）→「ユーザーIDをコピー」',
    ].join('\n'))
    .setRequired(true)
    .setValidation(FormApp.createTextValidation()
      .requireTextMatchesPattern('^[0-9]{17,20}$')
      .setHelpText('17〜20桁の数字で入力してください')
      .build());

  form.addTextItem()
    .setTitle('GitHub アカウント（任意）')
    .setHelpText('お持ちの方のみ。将来 GitHub でコードを管理する場合に使います。');

  // --- セクション2: 参加のしかた ---
  form.addPageBreakItem().setTitle('参加のしかた');

  form.addCheckboxItem()
    .setTitle('参加したい内容（複数可）')
    .setChoiceValues([
      '共同開発（コードを書く）',
      'テスター（動画で動作確認・不具合報告）',
      '譜面データの確認・simai の書き起こしチェック',
      '要望・アイデア出しのみ',
      'デザイン・説明書づくり',
    ])
    .showOtherOption(true)
    .setRequired(true);

  form.addCheckboxItem()
    .setTitle('できること・経験（複数可）')
    .setChoiceValues([
      'JavaScript',
      'Chrome 拡張機能（Manifest V3）',
      'Canvas / 動画・画像処理',
      'simai 記法が読める・書ける',
      'Docker',
      'Git / GitHub',
      '特になし（これから覚えたい）',
    ])
    .showOtherOption(true);

  form.addMultipleChoiceItem()
    .setTitle('maimai のプレイ歴')
    .setChoiceValues(['プレイしていない', '1年未満', '1〜3年', '3年以上'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('PC 版 Google Chrome を使えますか？')
    .setHelpText('拡張機能の動作確認に必要です。')
    .setChoiceValues(['はい（Windows）', 'はい（Mac）', 'はい（その他）', 'いいえ'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('関われる頻度の目安')
    .setChoiceValues(['ほぼ毎日', '週に数回', '週末だけ', '気が向いたとき'])
    .setRequired(true);

  // --- セクション3: 要望・自由記述 ---
  form.addPageBreakItem().setTitle('要望・ひとこと');

  form.addParagraphTextItem()
    .setTitle('ほしい機能・改善してほしいこと（任意）');

  form.addParagraphTextItem()
    .setTitle('自己紹介・ひとこと（任意）');

  form.addCheckboxItem()
    .setTitle('同意事項')
    .setChoiceValues([
      '入力した Gmail アドレスに開発フォルダが共有されることに同意します',
      '入力内容が開発メンバーの管理・連絡に使われることに同意します',
      '共有されたファイルや未公開の情報を許可なく外部に公開しません',
    ])
    .setRequired(true)
    .setValidation(FormApp.createCheckboxValidation()
      .requireSelectExactly(3)
      .setHelpText('すべてにチェックしてください')
      .build());

  // --- 回答シート ---
  const ss = SpreadsheetApp.create(`${PROJECT_NAME} 共同開発メンバー管理`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  const sheet = waitForResponseSheet_(ss, form);
  sheet.setName('応募一覧');
  setupManagementColumns_(sheet);

  ScriptApp.newTrigger('onOpenManagement')
    .forSpreadsheet(ss)
    .onOpen()
    .create();
  replaceSubmitTrigger_(form, 'onRecruitSubmit');

  PropertiesService.getScriptProperties().setProperty('RECRUIT_SHEET_ID', ss.getId());

  Logger.log('募集フォーム（回答用URL・Discordに貼る）: ' + form.getPublishedUrl());
  Logger.log('募集フォーム（編集用URL）: ' + form.getEditUrl());
  Logger.log('管理シート: ' + ss.getUrl());
}

// ===== 要望・不具合フォーム =====
function createRequestForm() {
  const form = FormApp.create(`${PROJECT_NAME} 要望・不具合報告`);
  form.setDescription('simai-overlay への要望・不具合報告・質問はすべてこちらのフォームから送ってください。');
  form.setConfirmationMessage('送信ありがとうございます！ 内容を確認して対応します。');

  form.addTextItem()
    .setTitle(Q_DISCORD_NAME)
    .setHelpText('返信先がわかるように。匿名希望なら空欄でOK。');

  form.addMultipleChoiceItem()
    .setTitle('種類')
    .setChoiceValues(['不具合（バグ）', '新しい機能の要望', '今ある機能の改善', '質問', 'その他'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('関係する機能')
    .setChoiceValues([
      '譜面の重ね表示',
      '判定円・最初のノーツの自動検出',
      'スライド・タッチの表示',
      '動画から simai の下書き',
      '曲の検索（OTOGE DB）',
      'よくわからない',
    ])
    .showOtherOption(true);

  addVersionQuestion_(form);

  form.addTextItem()
    .setTitle('タイトル（ひとことで）')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('内容')
    .setHelpText('不具合の場合は「何をしたら」「どうなって」「本当はどうなってほしいか」を書いてください。')
    .setRequired(true);

  form.addTextItem()
    .setTitle('YouTube の URL・曲名・難易度（わかれば）');

  form.addMultipleChoiceItem()
    .setTitle('優先度（あなたの感覚で）')
    .setChoiceValues(['すぐ直してほしい', 'あると嬉しい', 'いつでもいい']);

  const ss = SpreadsheetApp.create(`${PROJECT_NAME} 要望・不具合一覧`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  const sheet = waitForResponseSheet_(ss, form);
  sheet.setName(REQUEST_SHEET);
  addColumnWithChoices_(sheet, '対応状況', ['未着手', '検討中', '対応中', '完了', '対応しない']);
  addColumn_(sheet, '担当（Discord 名）');
  addColumn_(sheet, '対応メモ');
  sheet.setFrozenRows(1);
  replaceSubmitTrigger_(form, 'onRequestSubmit');

  PropertiesService.getScriptProperties().setProperty('REQUEST_SHEET_ID', ss.getId());
  setupTaskSheet_(ss);
  installTaskTriggers_(ss);

  Logger.log('要望フォーム（回答用URL）: ' + form.getPublishedUrl());
  Logger.log('要望一覧シート: ' + ss.getUrl());
}

// すでに作った要望フォームに、修正タスクの仕組みだけを足す（何度実行しても大丈夫）
//   ・フォームに「使っているバージョン」の質問を足す
//   ・要望一覧に「タスクID」列、「修正タスク」シートを足す
//   ・送信時 / 編集時 / 開いたときのトリガーを付ける
function setupTaskManagement() {
  const ss = getRequestSpreadsheet_();
  const req = ss.getSheetByName(REQUEST_SHEET);
  if (!req) throw new Error(`シート「${REQUEST_SHEET}」が見つかりません。シート名を変えていないか確認してください。`);
  const formUrl = req.getFormUrl();
  if (formUrl) {
    addVersionQuestion_(FormApp.openByUrl(formUrl));
    SpreadsheetApp.flush();
  }
  setupTaskSheet_(ss);
  installTaskTriggers_(ss);
  Logger.log('修正タスクの準備ができました: ' + ss.getUrl());
}

// ===== 修正タスク =====
function onOpenRequests() {
  SpreadsheetApp.getUi()
    .createMenu('タスク管理')
    .addItem('選んだ行をタスクにする（要望一覧で）', 'createTasksFromSelection')
    .addToUi();
}

// 要望一覧に回答が書き込まれたとき（スプレッドシートの送信トリガー）。不具合ならタスクにする
function onRequestRowSubmit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== REQUEST_SHEET) return;
  const row = e.range.getRow();
  const col = headerMap_(sheet);
  if (col['種類'] === undefined) return;
  const kind = String(sheet.getRange(row, col['種類'] + 1).getValue());
  if (kind.startsWith('不具合')) createTaskFromRow_(sheet.getParent(), row);
}

// 要望一覧で選んだ行（複数可）をタスクにする。すでにタスクIDがある行は飛ばす
function createTasksFromSelection() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== REQUEST_SHEET) {
    notify_(`「${REQUEST_SHEET}」シートで、タスクにしたい行を選んでから実行してください。`);
    return;
  }
  const rows = new Set();
  sheet.getActiveRangeList().getRanges().forEach(r => {
    for (let i = Math.max(r.getRow(), 2); i <= r.getLastRow(); i++) rows.add(i);
  });
  const created = [...rows].sort((a, b) => a - b)
    .map(row => createTaskFromRow_(sheet.getParent(), row))
    .filter(Boolean);
  notify_(created.length
    ? `タスクにしました: ${created.join(', ')}`
    : '新しく作ったタスクはありません（選んだ行はもうタスクになっているか、空です）。');
}

// 修正タスクの「ステータス」が変わったら、完了日を入れて、要望一覧の「対応状況」も合わせる
function onTaskEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== TASK_SHEET) return;
  const tc = headerMap_(sheet);
  if (tc['ステータス'] === undefined || tc['タスクID'] === undefined) return;
  const statusCol = tc['ステータス'] + 1;
  if (e.range.getColumn() > statusCol || e.range.getLastColumn() < statusCol) return;

  const req = sheet.getParent().getSheetByName(REQUEST_SHEET);
  const rc = req ? headerMap_(req) : {};
  const canSync = req && rc[REQ_COL_TASK] !== undefined && rc['対応状況'] !== undefined && req.getLastRow() >= 2;
  const reqIds = canSync
    ? req.getRange(2, rc[REQ_COL_TASK] + 1, req.getLastRow() - 1, 1).getValues().map(r => String(r[0]))
    : [];

  for (let r = Math.max(e.range.getRow(), 2); r <= e.range.getLastRow(); r++) {
    const status = String(sheet.getRange(r, statusCol).getValue());
    const id = String(sheet.getRange(r, tc['タスクID'] + 1).getValue());
    if (!id) continue;
    if (tc['完了日'] !== undefined) {
      const done = sheet.getRange(r, tc['完了日'] + 1);
      if (status === '完了') { if (!done.getValue()) done.setValue(new Date()); }
      else if (done.getValue()) done.clearContent();
    }
    const i = reqIds.indexOf(id);
    if (i >= 0 && REQUEST_STATUS_FROM_TASK[status]) {
      req.getRange(i + 2, rc['対応状況'] + 1).setValue(REQUEST_STATUS_FROM_TASK[status]);
    }
  }
}

// ===== 管理シートのメニューとフォルダ共有 =====
function onOpenManagement() {
  SpreadsheetApp.getUi()
    .createMenu('共同開発管理')
    .addItem('承認者にフォルダを共有', 'shareFolderWithApproved')
    .addToUi();
}

// ステータスが「承認」で、まだ共有していない人に SHARE_FOLDER_ID を共有する
function shareFolderWithApproved() {
  const sheet = getRecruitSheet_();
  const folder = DriveApp.getFolderById(SHARE_FOLDER_ID);
  const { rows, col } = readSheet_(sheet);
  const shared = [];

  rows.forEach((row, i) => {
    if (row[col[COL_STATUS]] !== '承認' || row[col[COL_SHARED_AT]]) return;
    const email = String(row[col[Q_GMAIL]]).trim();
    if (!email) return;
    if (SHARE_ROLE === 'viewer') folder.addViewer(email);
    else folder.addEditor(email);

    const r = i + 2;
    sheet.getRange(r, col[COL_SHARED_AT] + 1).setValue(new Date());
    sheet.getRange(r, col[COL_STATUS] + 1).setValue('共有済み');
    shared.push(`${row[col[Q_DISCORD_NAME]]} (${email})`);
  });

  if (shared.length) {
    postDiscord_('RECRUIT_WEBHOOK_URL', {
      title: '📁 開発フォルダを共有しました',
      description: shared.map(s => '・' + (NOTIFY_INCLUDE_PRIVATE ? s : s.replace(/ \(.*\)$/, ''))).join('\n'),
      color: 0x2ecc71,
    });
  }
  notify_(shared.length
    ? `共有しました（${shared.length}人）:\n` + shared.join('\n')
    : '新しく共有する人はいませんでした。ステータスを「承認」にしてから実行してください。');
}

// ===== Discord 通知（フォーム送信時のトリガーから呼ばれる） =====
function onRecruitSubmit(e) {
  const answers = answersOf_(e.response);
  const hidden = NOTIFY_INCLUDE_PRIVATE ? [] : [Q_GMAIL, Q_DISCORD_ID];
  const sheetId = PropertiesService.getScriptProperties().getProperty('RECRUIT_SHEET_ID');
  postDiscord_('RECRUIT_WEBHOOK_URL', {
    title: '🙋 共同開発メンバーの応募がありました',
    url: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : undefined,
    color: 0x5865f2,
    fields: answers
      .filter(a => !hidden.includes(a.title) && a.title !== '同意事項')
      .map(a => ({ name: a.title, value: a.value, inline: a.value.length <= 30 })),
    footer: { text: '管理シートでステータスを選んでください' },
    timestamp: e.response.getTimestamp().toISOString(),
  });
}

function onRequestSubmit(e) {
  const answers = answersOf_(e.response);
  const get = title => (answers.find(a => a.title === title) || {}).value;
  const kind = get('種類') || '';
  const sheetId = PropertiesService.getScriptProperties().getProperty('REQUEST_SHEET_ID');
  postDiscord_('REQUEST_WEBHOOK_URL', {
    title: `${kind.startsWith('不具合') ? '🐞' : '💡'} ${get('タイトル（ひとことで）') || '要望・不具合'}`,
    url: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : undefined,
    description: get('内容'),
    color: kind.startsWith('不具合') ? 0xe74c3c : 0xf1c40f,
    fields: answers
      .filter(a => !['タイトル（ひとことで）', '内容'].includes(a.title))
      .map(a => ({ name: a.title, value: a.value, inline: a.value.length <= 30 })),
    timestamp: e.response.getTimestamp().toISOString(),
  });
}

// Webhook が届くか確認する（スクリプトエディタから実行）
function testWebhook() {
  postDiscord_('DISCORD_WEBHOOK_URL', {
    title: '✅ テスト通知',
    description: `${PROJECT_NAME} のフォーム通知が設定できました。`,
    color: 0x2ecc71,
  });
  Logger.log('送信しました。Discord を確認してください。');
}

// フォームを作り直さずに通知トリガーだけ付け直す（古い版で作ったフォームに通知を足すときなど）
function installNotifyTriggers() {
  const props = PropertiesService.getScriptProperties();
  [['RECRUIT_SHEET_ID', 'onRecruitSubmit'], ['REQUEST_SHEET_ID', 'onRequestSubmit']].forEach(([key, handler]) => {
    const id = props.getProperty(key);
    if (!id) { Logger.log(`${key} がないのでスキップ: ${handler}`); return; }
    const formUrl = SpreadsheetApp.openById(id).getSheets().map(s => s.getFormUrl()).find(Boolean);
    if (!formUrl) { Logger.log(`${key} のシートにフォームがつながっていません`); return; }
    replaceSubmitTrigger_(FormApp.openByUrl(formUrl), handler);
    Logger.log(`通知トリガーを設定しました: ${handler}`);
  });
}

// ===== 内部ヘルパー =====
function waitForResponseSheet_(ss, form) {
  const formId = form.getId();
  for (let i = 0; i < 20; i++) {
    SpreadsheetApp.flush();
    const sheet = ss.getSheets().find(s => {
      const url = s.getFormUrl();
      return url && url.indexOf(formId) !== -1;
    });
    if (sheet) return sheet;
    Utilities.sleep(500);
  }
  throw new Error('回答シートが見つかりません。少し待ってから再実行してください。');
}

function setupManagementColumns_(sheet) {
  addColumnWithChoices_(sheet, COL_STATUS, STATUS_VALUES);
  addColumn_(sheet, COL_SHARED_AT);
  addColumn_(sheet, COL_MEMO);
  sheet.setFrozenRows(1);
}

function addColumn_(sheet, title) {
  const c = sheet.getLastColumn() + 1;
  sheet.getRange(1, c).setValue(title).setFontWeight('bold').setBackground('#fff2cc');
  return c;
}

function addColumnWithChoices_(sheet, title, choices) {
  const c = addColumn_(sheet, title);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(choices, true).build();
  sheet.getRange(2, c, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

function getRecruitSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('RECRUIT_SHEET_ID');
  if (!id) throw new Error('先に createRecruitForm を実行してください。');
  return SpreadsheetApp.openById(id).getSheetByName('応募一覧');
}

// 1行目の見出し名 → 列番号(0始まり)
function headerMap_(sheet) {
  const col = {};
  if (sheet.getLastColumn() === 0) return col;
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .forEach((h, i) => { const k = String(h).trim(); if (k && col[k] === undefined) col[k] = i; });
  return col;
}

function getRequestSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('REQUEST_SHEET_ID');
  if (!id) throw new Error('スクリプトプロパティ REQUEST_SHEET_ID がありません。先に createRequestForm を実行するか、要望一覧シートの ID を入れてください。');
  return SpreadsheetApp.openById(id);
}

// 「使っているバージョン」の質問を「関係する機能」のすぐ後ろに足す（もうあれば何もしない）
function addVersionQuestion_(form) {
  const items = form.getItems();
  if (items.some(i => i.getTitle() === Q_VERSION)) return;
  const item = form.addTextItem()
    .setTitle(Q_VERSION)
    .setHelpText('chrome://extensions の「譜面重ね表示」に出ている番号（例: 0.2.0）。わからなければ空欄でOK。');
  const after = items.find(i => i.getTitle() === '関係する機能');
  if (after) form.moveItem(item.getIndex(), after.getIndex() + 1);
}

// 要望一覧に「タスクID」列、「修正タスク」シートを用意する（もうあればそのまま返す）
function setupTaskSheet_(ss) {
  const req = ss.getSheetByName(REQUEST_SHEET);
  if (req && headerMap_(req)[REQ_COL_TASK] === undefined) addColumn_(req, REQ_COL_TASK);

  let sheet = ss.getSheetByName(TASK_SHEET);
  if (sheet) return sheet;
  sheet = ss.insertSheet(TASK_SHEET);
  const n = TASK_HEADERS.length;
  const rows = sheet.getMaxRows() - 1;
  const c = name => TASK_HEADERS.indexOf(name) + 1;
  const list = values => SpreadsheetApp.newDataValidation().requireValueInList(values, true).build();

  sheet.getRange(1, 1, 1, n).setValues([TASK_HEADERS]).setFontWeight('bold').setBackground('#d9ead3');
  sheet.setFrozenRows(1);
  sheet.getRange(2, c('ステータス'), rows, 1).setDataValidation(list(TASK_STATUS));
  sheet.getRange(2, c('優先度'), rows, 1).setDataValidation(list(TASK_PRIORITY));
  sheet.getRange(2, c('起票日'), rows, 1).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, c('完了日'), rows, 1).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, c('内容'), rows, 1).setWrap(true);
  sheet.setColumnWidth(c('タイトル'), 220);
  sheet.setColumnWidth(c('内容'), 320);
  sheet.setColumnWidth(c('対応メモ'), 240);

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
  sheet.getRange(1, 1, sheet.getMaxRows(), n).createFilter();
  return sheet;
}

// 要望一覧の row 行目から修正タスクを1つ作り、作ったタスクID を返す（もうタスクがある・空の行なら null）
function createTaskFromRow_(ss, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const req = ss.getSheetByName(REQUEST_SHEET);
    const tasks = setupTaskSheet_(ss);
    const rc = headerMap_(req);
    const values = req.getRange(row, 1, 1, req.getLastColumn()).getValues()[0];
    const v = h => (rc[h] === undefined ? '' : values[rc[h]]);
    if (v(REQ_COL_TASK) || !v('タイトル（ひとことで）')) return null;

    const kind = String(v('種類'));
    const id = nextTaskId_(tasks, kind.startsWith('不具合') ? 'BUG' : 'REQ');
    // 回答が = + - @ で始まっていても数式にしない
    const text = s => (typeof s === 'string' && /^[=+\-@]/.test(s) ? "'" + s : s);
    const tc = headerMap_(tasks);
    const out = new Array(tasks.getLastColumn()).fill('');
    const set = (h, val) => { if (tc[h] !== undefined) out[tc[h]] = val; };
    set('タスクID', id);
    set('ステータス', '未着手');
    set('優先度', PRIORITY_FROM_FORM[v('優先度（あなたの感覚で）')] || '中');
    set('タイトル', text(v('タイトル（ひとことで）')));
    set('種類', kind);
    set('関係する機能', text(v('関係する機能')));
    set('内容', text(v('内容')));
    set('動画・曲', text(v('YouTube の URL・曲名・難易度（わかれば）')));
    set('報告バージョン', text(String(v(Q_VERSION))));
    set('報告者', text(v(Q_DISCORD_NAME)));
    set('起票日', v('タイムスタンプ') || new Date());
    set('元の報告', `=HYPERLINK("#gid=${req.getSheetId()}&range=A${row}","${REQUEST_SHEET} ${row}行目")`);
    tasks.getRange(tasks.getLastRow() + 1, 1, 1, out.length).setValues([out]);

    req.getRange(row, rc[REQ_COL_TASK] + 1).setValue(id);
    if (rc['対応状況'] !== undefined && !v('対応状況')) req.getRange(row, rc['対応状況'] + 1).setValue('未着手');
    return id;
  } finally {
    lock.releaseLock();
  }
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

function installTaskTriggers_(ss) {
  const handlers = ['onRequestRowSubmit', 'onTaskEdit', 'onOpenRequests'];
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onRequestRowSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onTaskEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onOpenRequests').forSpreadsheet(ss).onOpen().create();
}

function columnLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// 見出し名 → 列番号(0始まり) の対応と、データ行を返す
function readSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  const col = {};
  values[0].forEach((h, i) => { col[String(h).trim()] = i; });
  [COL_STATUS, COL_SHARED_AT, Q_GMAIL, Q_DISCORD_NAME, Q_DISCORD_ID].forEach(h => {
    if (col[h] === undefined) throw new Error(`列「${h}」が見つかりません。見出しを変えていないか確認してください。`);
  });
  return { rows: values.slice(1), col };
}

function replaceSubmitTrigger_(form, handler) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(handler).forForm(form).onFormSubmit().create();
}

// 回答を [{ title, value }] にする（未回答は除く。チェックボックスは「、」区切り）
function answersOf_(response) {
  return response.getItemResponses()
    .map(r => {
      const v = r.getResponse();
      return { title: r.getItem().getTitle(), value: String(Array.isArray(v) ? v.join('、') : v).trim() };
    })
    .filter(a => a.value);
}

// Discord に embed を1つ投稿する。propKey の URL がなければ DISCORD_WEBHOOK_URL を使う
function postDiscord_(propKey, embed) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty(propKey) || props.getProperty('DISCORD_WEBHOOK_URL');
  if (!url) {
    Logger.log('DISCORD_WEBHOOK_URL が未設定なので通知しませんでした');
    return;
  }
  // Discord の文字数上限に合わせて切り詰める
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
  embed.title = cut(embed.title, 256);
  embed.description = cut(embed.description, 4000);
  if (embed.fields) {
    embed.fields = embed.fields.slice(0, 25).map(f => ({ ...f, name: cut(f.name, 256), value: cut(f.value, 1024) }));
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      username: `${PROJECT_NAME} フォーム`,
      embeds: [embed],
      // 回答に @everyone などが書かれていてもメンションにしない
      allowed_mentions: { parse: [] },
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    Logger.log(`Discord 通知に失敗しました (${res.getResponseCode()}): ${res.getContentText()}`);
  }
}

// シートのメニューから実行したときはダイアログ、スクリプトエディタから実行したときはログに出す
function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
