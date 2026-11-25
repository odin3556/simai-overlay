const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../extension/lib/simai/parse.js');
const { locate } = require('../extension/lib/simai/timing.js');

const TEXT = '|| コメントの行\n(120){4}1,2,\n3,,\n{8}5,6,E';
const p = parse(TEXT);
const at = (beat) => locate(TEXT, p.cells, beat);

test('いまの場所: 区切りの位置はコメントがあっても元の文字の位置', () => {
  // 区切り: 1（拍 0）、2（拍 1）、3（拍 2）、空（拍 3）、5（拍 4）、6（拍 4.5）
  assert.deepEqual(p.cells.map((c) => c.beat), [0, 1, 2, 3, 4, 4.5]);
  assert.equal(TEXT.slice(p.cells[0].start, p.cells[0].end), '|| コメントの行\n(120){4}1');
  assert.equal(TEXT.slice(p.cells[4].start, p.cells[4].end), '\n{8}5');
});

test('いまの場所: 行と、行の中のいまの区切り', () => {
  assert.deepEqual(at(0), { line: 2, start: TEXT.indexOf('(120)'), end: TEXT.indexOf('2,'), before: '', cell: '(120){4}1,', after: '2,' });
  const two = at(1.5); // 2 を叩いたあと、3 の前
  assert.equal(two.line, 2);
  assert.equal(two.cell, '2,');
  assert.equal(two.before, '(120){4}1,');
  const three = at(2);
  assert.equal(three.line, 3);
  assert.deepEqual([three.before, three.cell, three.after], ['', '3,', ',']);
  assert.equal(at(3.2).cell, ',');
  const six = at(4.7);
  assert.equal(six.line, 4);
  assert.deepEqual([six.before, six.cell, six.after], ['{8}5,', '6,', 'E']);
});

test('いまの場所: 始まる前は null', () => {
  assert.equal(at(-0.5), null);
  assert.equal(locate('', [], 0), null);
});
