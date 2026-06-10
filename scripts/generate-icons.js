/**
 * 生成 PWA 图标 — 从 icons/fish-source.png 缩放
 * 依赖：pip install pillow，然后运行 python3 scripts/generate-icons.py
 * 或：node scripts/generate-icons.js（调用 Python 脚本）
 */
var cp = require('child_process');
var path = require('path');

var py = path.join(__dirname, 'generate-icons.py');
cp.execFile('python3', [py], function (err, stdout, stderr) {
  if (err) {
    console.error(stderr || err.message);
    console.error('请先安装 Pillow：pip install pillow');
    process.exit(1);
  }
  if (stdout) process.stdout.write(stdout);
});
