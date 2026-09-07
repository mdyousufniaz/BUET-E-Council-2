// Run with:  node --test meeting_service/utils/agendaSerial.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripProposalPrefix, stripResolutionPrefix } = require('./agendaSerial');

test('stripProposalPrefix: leaves a mid-text year range untouched (bug: "2026-2027" -> "2027")', () => {
  assert.equal(
    stripProposalPrefix('<p>Session 2026-2027 budget</p>'),
    '<p>Session 2026-2027 budget</p>',
  );
});

test('stripProposalPrefix: does not eat the space before a number ("word 2026-" concat bug)', () => {
  assert.equal(
    stripProposalPrefix('<p>শিক্ষাবর্ষ ২০২৬-২০২৭ এর জন্য</p>'),
    '<p>শিক্ষাবর্ষ ২০২৬-২০২৭ এর জন্য</p>',
  );
});

test('stripProposalPrefix: a paragraph that *starts* with a year range keeps both years', () => {
  assert.equal(stripProposalPrefix('<p>2026-2027</p>'), '<p>2026-2027</p>');
  assert.equal(stripProposalPrefix('<p>২০২৬-২০২৭ সাল</p>'), '<p>২০২৬-২০২৭ সাল</p>');
});

test('stripProposalPrefix: still strips a genuine leading Bangla serial "৫ :"', () => {
  assert.equal(stripProposalPrefix('<p>৫ : মূল প্রস্তাব</p>'), '<p>মূল প্রস্তাব</p>');
});

test('stripProposalPrefix: still strips a leading serial with a "." or "-" terminator', () => {
  assert.equal(stripProposalPrefix('<p>১২. আলোচ্যসূচি</p>'), '<p>আলোচ্যসূচি</p>');
  assert.equal(stripProposalPrefix('<p>12 - some agenda</p>'), '<p>some agenda</p>');
});

test('stripProposalPrefix: still strips the official "প্রস্তাব নং এ ২১০৬ :" marker', () => {
  assert.equal(
    stripProposalPrefix('<p>প্রস্তাব নং এ ২১০৬ : বিষয়বস্তু</p>'),
    '<p>বিষয়বস্তু</p>',
  );
});

test('stripProposalPrefix: never touches a "বিবিধ :" body', () => {
  assert.equal(stripProposalPrefix('<p>বিবিধ : কিছু ২০২৬-২০২৭</p>'), '<p>বিবিধ : কিছু ২০২৬-২০২৭</p>');
});

test('stripProposalPrefix: no <p> wrapper, plain leading text with a range is untouched', () => {
  assert.equal(stripProposalPrefix('plain 2026-2027 text'), 'plain 2026-2027 text');
});

test('stripProposalPrefix: empty / nullish input', () => {
  assert.equal(stripProposalPrefix(''), '');
  assert.equal(stripProposalPrefix(null), '');
  assert.equal(stripProposalPrefix(undefined), '');
});

test('stripResolutionPrefix: strips a leading "সিদ্ধান্ত :" but keeps a following year range', () => {
  assert.equal(
    stripResolutionPrefix('<p>সিদ্ধান্ত : ২০২৬-২০২৭ শিক্ষাবর্ষে</p>'),
    '<p>২০২৬-২০২৭ শিক্ষাবর্ষে</p>',
  );
});
