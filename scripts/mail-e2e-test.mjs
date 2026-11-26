#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   自动投递端到端复测（/api/challenge → PoW → /api/deliver）

   用途：验收「访客填任意邮箱 → 站点自动发出简历邮件」这条链路。
   为什么不用 curl：/api/deliver 要求「本站在 15 分钟内签发、绑定当前 IP、
   并解出 PoW」的凭证，直接 POST 一定是 Forbidden / verification_required。
   本脚本把前端那套凭证流程在 Node 里重放一遍，因此与「真人点按钮」等价，
   但不依赖浏览器。

   用法：
     node scripts/mail-e2e-test.mjs --to you@example.com
     node scripts/mail-e2e-test.mjs --to you@example.com --base https://shenge-work.pages.dev
     node scripts/mail-e2e-test.mjs --to a@x.com --dry-run     # 只取证 + 求解，不投递

   注意：
   - 会真的发一封邮件，附件为简历 PDF，占收件人当日 2 封额度（functions/api/deliver.js
     的 TO_DAY_LIMIT=2），同一地址一天最多测 2 次。
   - 退出码：0 = 投递成功；1 = 失败（错误码与原因打到 stderr）。
   ────────────────────────────────────────────────────────────────────── */

import { createHash } from 'node:crypto';

const DEFAULT_BASE = 'https://chenpeisheng.cn';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, to: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i] || '';
    else if (a === '--base') out.base = (argv[++i] || DEFAULT_BASE).replace(/\/+$/, '');
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function headers(base) {
  const origin = new URL(base).origin;
  return {
    Origin: origin,
    Referer: origin + '/resume',
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
}

/* 与前端一致：sha256(token + ':' + nonce) 前缀要有 difficulty 个 0 */
function solvePow(token, difficulty) {
  const target = '0'.repeat(difficulty);
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    const hex = createHash('sha256').update(token + ':' + String(nonce)).digest('hex');
    if (hex.startsWith(target)) return { nonce, hex };
  }
  return null;
}

async function getChallenge(base) {
  const res = await fetch(base + '/api/challenge', { headers: headers(base) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 下面按非 JSON 处理 */ }
  if (!res.ok || !body || !body.ok) {
    throw new Error(`挑战签发失败 HTTP ${res.status}：${body ? JSON.stringify(body) : text.slice(0, 200)}`);
  }
  return body;
}

async function deliver(base, payload) {
  const res = await fetch(base + '/api/deliver', {
    method: 'POST',
    headers: { ...headers(base), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  return { status: res.status, body, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.to) {
    console.error('用法: node scripts/mail-e2e-test.mjs --to <email> [--base <url>] [--dry-run]');
    process.exit(2);
  }

  console.log(`▸ 目标站: ${args.base}`);
  console.log(`▸ 收件人: ${args.to}`);

  const ch = await getChallenge(args.base);
  console.log(`▸ 凭证: ${String(ch.token).slice(0, 24)}… 难度 ${ch.difficulty}`);

  const t0 = Date.now();
  const solved = ch.difficulty > 0 ? solvePow(ch.token, ch.difficulty) : { nonce: 0 };
  if (!solved) throw new Error('PoW 求解失败（难度异常？）');
  console.log(`▸ PoW: nonce=${solved.nonce}，耗时 ${Date.now() - t0}ms`);

  if (args.dryRun) {
    console.log('▸ dry-run：已拿到可投递凭证，未发信');
    return;
  }

  const out = await deliver(args.base, {
    to: args.to,
    name: '陈培胜',
    email: 'hi@chenpeisheng.cn',
    note: '这是一封自动投递链路的验收测试邮件，用于核对发件身份与认证结果，请忽略。',
    verify: { token: ch.token, nonce: solved.nonce },
  });

  if ((out.status === 200 || out.status === 201) && out.body && out.body.ok) {
    console.log(`✓ 投递成功 HTTP ${out.status}`);
    console.log('  id: ' + (out.body.id || '(未返回)'));
    console.log('  to: ' + (out.body.to || args.to));
    console.log('  下一步：到收件箱点「显示原始邮件」，确认');
    console.log('    From: 陈培胜 <hi@chenpeisheng.cn>');
    console.log('    dkim=pass header.d=chenpeisheng.cn');
    console.log('    spf=pass smtp.mailfrom=send.chenpeisheng.cn');
    return;
  }

  const code = (out.body && out.body.error) || 'unknown';
  const msg = (out.body && out.body.message) || out.text.slice(0, 200);
  console.error(`✗ 投递失败 HTTP ${out.status}  error=${code}`);
  console.error('  ' + msg);

  const hint = {
    resend_not_configured: '环境变量 RESEND_API_KEY 为空 → Pages 项目变量被清空，重设后必须重新部署',
    recipient_not_verified: 'Resend 域名未验证，或 RESEND_FROM 不是该域名下的地址',
    verification_failed: '凭证与本机 IP / 用途不匹配（换网络后重跑一次）',
    verification_expired: '凭证过期（>15 分钟），重跑即可',
    rate_limited: '触发限流：同一收件人每天 2 封、同 IP 每小时 3 封 / 每天 5 封',
    origin_not_allowed: '--base 与 Origin 不一致，换用站点自己的域名',
  }[code];
  if (hint) console.error('  提示: ' + hint);
  process.exit(1);
}

main().catch((e) => {
  console.error('✗ ' + (e && e.message ? e.message : e));
  process.exit(1);
});
