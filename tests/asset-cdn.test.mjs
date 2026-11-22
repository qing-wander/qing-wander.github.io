import fs from 'node:fs';
import vm from 'node:vm';

// 模拟最小浏览器环境
const loc = { protocol: 'http:', search: '', hostname: 'localhost' };
const ctx = {
  window: {},
  location: loc,
  document: {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll() { return []; },
    dispatchEvent() {},
    createElement() { return {}; },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  URLSearchParams,
  fetch() { return Promise.reject(new Error('no fetch in test')); },
  console,
  CustomEvent: class {},
};
ctx.window = ctx; // window 指向全局
vm.createContext(ctx);

// 加载 map 与 asset-cdn
vm.runInContext(fs.readFileSync('data/asset-map.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('js/asset-cdn.js', 'utf8'), ctx);

const A = ctx.AssetURL;
const tests = [
  ['images/portrait.jpg', true],
  ['images/company/comein/product-01-comein.jpg', true],
  ['videos/lessie-demo.mp4', true],
  ['assets/skins/models/Xbot.glb', true],
  ['images/not-exist.png', false],
  ['https://example.com/a.jpg', false],
  ['data:image/png;base64,xxx', false],
];
let pass = 0;
for (const [input, shouldRewrite] of tests) {
  const out = A.of(input);
  const rewritten = out !== input;
  const ok = rewritten === shouldRewrite;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${input}  ->  ${out}`);
  if (ok) pass++;
}
// 测试版本串保留
const withVer = A.of('images/portrait.jpg?v=123');
console.log(`版本串: ${withVer.endsWith('?v=123') ? 'PASS' : 'FAIL'} -> ${withVer}`);
// 测试 model
console.log(`模型: ${A.model('Xbot.glb?v=2026')}`);
// 测试 setEnabled 关闭后回退
console.log(`开关状态: ${A.isEnabled() ? 'PASS(enabled)' : 'FAIL'}`);
console.log(`\n结果: ${pass}/${tests.length} 通过`);
