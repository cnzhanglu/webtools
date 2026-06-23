#!/usr/bin/env node
/**
 * 工具箱单元测试入口（Node.js，无外部依赖）
 *
 * 用法：node tests/run-tests.js
 * 退出码：0 = 全部通过；1 = 存在失败
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var passed = 0;
var failed = 0;

function loadScript(relPath) {
  var full = path.join(ROOT, relPath);
  var code = fs.readFileSync(full, 'utf8');
  vm.runInThisContext(code, { filename: relPath });
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    console.error('  \u2717 ' + name);
    console.error('    ' + (e && e.message ? e.message : e));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}

// 按依赖顺序加载被测模块
loadScript('shared/js/ipcidr.js');

console.log('\nBocIpCidr');
require('./ipcidr.test.js')(test, assert, assertEq);

loadScript('tools/net-policy/js/ip.js');
console.log('\nNetPolicyIp');
require('./net-policy-ip.test.js')(test, assert, assertEq);

loadScript('tools/excel2json/js/validate.js');
console.log('\nExcel2JsonValidate');
require('./excel2json-validate.test.js')(test, assert, assertEq);

loadScript('tools/excel2json/js/process.js');
console.log('\nExcel2JsonProcess');
require('./excel2json-process.test.js')(test, assert, assertEq);

console.log('\nSW / Registry');
require('./sw-precache.test.js')(test, assert, assertEq, ROOT);

console.log('\n' + '-'.repeat(40));
console.log('通过 ' + passed + '，失败 ' + failed);
process.exit(failed > 0 ? 1 : 0);
