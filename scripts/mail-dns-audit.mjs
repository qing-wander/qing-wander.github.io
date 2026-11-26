#!/usr/bin/env node
/**
 * 域名邮件配置体检 / 迁移验收
 *
 *   node scripts/mail-dns-audit.mjs                 # 体检默认域名 chenpeisheng.cn
 *   node scripts/mail-dns-audit.mjs example.com     # 体检指定域名
 *   node scripts/mail-dns-audit.mjs --expect feishu # 按目标态验收（feishu|tencent|google）
 *
 * 只读：只做 DNS 查询，不改任何记录、不需要任何 token。
 * 退出码：0 = 全部通过；1 = 有告警；2 = 有致命问题（收不到信 / SPF 冲突 / 无 DMARC）。
 *
 * 用法上分两个阶段：
 *   迁移前 → 不带参数跑，看"现状体检"；
 *   迁移后 → --expect feishu（或 tencent / google）跑，逐条比对目标态，全绿再收工。
 */

import { Resolver } from 'node:dns/promises';

// 注意：node:dns 的模块级 setServers 在部分环境下不生效（系统解析器仍是 9 秒级），
// 必须用 Resolver 实例，并把超时/重试压下来，否则整脚本会被 TXT 查询拖死。
const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const DEFAULT_DOMAIN = 'chenpeisheng.cn';

// DKIM selector 探测表：不同服务商用的 selector 不一样，逐个查一遍看哪个存在。
// ⚠️ 飞书用的是「feishu + 启用时间戳」这种动态 selector（例如 feishu2611261416），
//    猜名字永远猜不全。要确认飞书到底签没签，**看真实邮件头**里的 s= 才准：
//      Gmail 打开邮件 → ⋮ → 显示原始邮件 → 找 DKIM-Signature 的 s= 与 Authentication-Results。
const DKIM_SELECTORS = [
  ['resend', 'Resend（事务邮件）'],
  ['cf2024-1', 'Cloudflare Email Routing'],
  ['cf2024-2', 'Cloudflare Email Routing（备用）'],
  ['feishu', '飞书邮箱'],
  ['feishu2611261416', '飞书邮箱（本域实际 selector，2026-11-26 启用）'],
  ['mail', '腾讯企业邮'],
  ['google', 'Google Workspace'],
  ['zmail', 'Zoho Mail'],
  ['default', '通用默认'],
  ['s1', '通用 s1'],
  ['k1', '通用 k1'],
];

// 目标态定义：只看"必须命中"的硬指标，不做全文匹配。
const EXPECTATIONS = {
  feishu: {
    label: '飞书邮箱',
    mx: ['mx1.feishu.cn', 'mx2.feishu.cn', 'mx3.feishu.cn'],
    spfIncludes: ['_netblocks.m.feishu.cn'],
    forbidSpfIncludes: ['_spf.mx.cloudflare.net'],
    foreignDkim: ['cf2024-1', 'cf2024-2'],
  },
  tencent: {
    label: '腾讯企业邮',
    mx: ['mxbiz1.qq.com', 'mxbiz2.qq.com'],
    spfIncludes: ['spf.mail.qq.com'],
    forbidSpfIncludes: ['_spf.mx.cloudflare.net'],
    foreignDkim: ['cf2024-1', 'cf2024-2'],
  },
  google: {
    label: 'Google Workspace',
    mx: ['aspmx.l.google.com'],
    spfIncludes: ['_spf.google.com'],
    forbidSpfIncludes: ['_spf.mx.cloudflare.net'],
    foreignDkim: ['cf2024-1', 'cf2024-2'],
  },
};

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const problems = { fatal: [], warn: [], ok: [] };

function line(level, msg) {
  const mark = { ok: `${c.green}✓${c.reset}`, warn: `${c.yellow}!${c.reset}`, fatal: `${c.red}✗${c.reset}` }[level];
  process.stdout.write(`${mark} ${msg}\n`);
  problems[level].push(msg);
}

function parseArgs(argv) {
  const out = { domain: DEFAULT_DOMAIN, expect: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--expect') out.expect = argv[++i];
    else if (a.startsWith('--expect=')) out.expect = a.slice('--expect='.length);
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-')) out.domain = a;
  }
  return out;
}

function withTimeout(promise, ms = 4000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('dns timeout')), ms).unref()),
  ]);
}

async function txt(name) {
  try {
    const rows = await withTimeout(resolver.resolveTxt(name));
    return rows.map((chunks) => chunks.join(''));
  } catch (err) {
    if (process.env.DEBUG_DNS) process.stderr.write(`[dns] TXT ${name} -> ${err.code || err.message}\n`);
    return [];
  }
}

async function mx(name) {
  try {
    const rows = await withTimeout(resolver.resolveMx(name));
    return rows.sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

function spfOf(records) {
  return records.filter((r) => /^v=spf1\b/i.test(r.trim()));
}

function tagValue(record, key) {
  const m = record.match(new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
}

async function main() {
  const { domain, expect, help } = parseArgs(process.argv.slice(2));

  if (help) {
    process.stdout.write(`用法：
  node scripts/mail-dns-audit.mjs [domain] [--expect feishu|tencent|google]

示例：
  node scripts/mail-dns-audit.mjs
  node scripts/mail-dns-audit.mjs chenpeisheng.cn --expect feishu
`);
    return 0;
  }

  if (expect && !EXPECTATIONS[expect]) {
    process.stderr.write(`未知的 --expect 目标：${expect}（可选：${Object.keys(EXPECTATIONS).join(' / ')}）\n`);
    return 2;
  }

  process.stdout.write(`\n${c.bold}邮件配置体检${c.reset}  ${c.cyan}${domain}${c.reset}${expect ? `  目标态：${EXPECTATIONS[expect].label}` : ''}\n`);
  process.stdout.write(`${c.dim}${new Date().toISOString()}${c.reset}\n\n`);

  // ---------- 1. MX ----------
  const mxRows = await mx(domain);
  process.stdout.write(`${c.bold}MX（决定谁替你收信）${c.reset}\n`);
  if (!mxRows.length) {
    line('fatal', '没有 MX 记录，这个域名现在收不到任何邮件');
  } else {
    for (const r of mxRows) process.stdout.write(`    ${String(r.priority).padStart(2)}  ${r.exchange}\n`);
    const hosts = mxRows.map((r) => r.exchange.replace(/\.$/, '').toLowerCase());
    if (hosts.some((h) => h.endsWith('mx.cloudflare.net'))) {
      line('warn', 'MX 指向 Cloudflare Email Routing：只收不发，回信只能用别的地址（详见 docs/email-deliverability.md）');
    } else {
      line('ok', 'MX 指向真实邮箱服务商（具备发信能力）');
    }
    if (expect) {
      const want = EXPECTATIONS[expect].mx;
      const hit = want.filter((w) => hosts.some((h) => h === w || h.endsWith(`.${w}`)));
      if (hit.length === want.length) line('ok', `MX 与目标 ${EXPECTATIONS[expect].label} 一致`);
      else line('fatal', `MX 与目标不一致：期望 ${want.join(' / ')}，命中 ${hit.length}/${want.length}`);
    }
  }

  // ---------- 2. SPF ----------
  const rootTxt = await txt(domain);
  const spf = spfOf(rootTxt);
  process.stdout.write(`\n${c.bold}SPF（声明谁有权用你的域名发信）${c.reset}\n`);
  if (spf.length === 0) {
    line('fatal', '根域没有 SPF 记录，用这个域名发信会大面积进垃圾箱');
  } else if (spf.length > 1) {
    line('fatal', `发现 ${spf.length} 条 SPF 记录，RFC 7208 规定多条即永久失败，必须合并成一条`);
    spf.forEach((s) => process.stdout.write(`    ${s}\n`));
  } else {
    process.stdout.write(`    ${spf[0]}\n`);
    // 粗略估算 SPF 的 DNS 查询次数：只数独立的 mechanism，不数主机名里的 "mx"
    const lookups = (spf[0].match(/(?:^|\s)(?:include:|a:|mx(?=\s|$)|ptr(?=\s|$)|exists:|redirect=)/gi) || []).length;
    if (lookups > 10) line('fatal', `SPF 的 DNS 查询次数约 ${lookups} 次，超过 10 次上限，会直接判 fail`);
    else if (lookups >= 8) line('warn', `SPF 查询次数约 ${lookups} 次，接近 10 次上限`);
    else line('ok', `SPF 只有一条，DNS 查询次数约 ${lookups} 次`);

    if (/_spf\.mx\.cloudflare\.net/i.test(spf[0])) {
      line('warn', 'SPF 只包含 Cloudflare 转发域：这条记录对"你用 hi@ 发信"没有任何作用（Cloudflare 不发信）');
    }
    if (/[-~]all\s*$/i.test(spf[0])) line('ok', 'SPF 有明确的 all 收尾策略');
    else line('warn', 'SPF 结尾没有 ~all 或 -all，策略不完整');

    if (expect) {
      const { spfIncludes, forbidSpfIncludes } = EXPECTATIONS[expect];
      const miss = spfIncludes.filter((i) => !spf[0].includes(i));
      const bad = forbidSpfIncludes.filter((i) => spf[0].includes(i));
      if (miss.length) line('fatal', `SPF 缺少目标服务商：${miss.join(', ')}`);
      else line('ok', 'SPF 已包含目标服务商');
      if (bad.length) line('warn', `SPF 仍包含旧转发域，建议移除：${bad.join(', ')}`);
    }
  }

  // ---------- 3. DKIM ----------
  process.stdout.write(`\n${c.bold}DKIM（决定转发/直发能不能过 DMARC）${c.reset}\n`);
  const found = [];
  const probes = await Promise.all(
    DKIM_SELECTORS.map(async ([selector, who]) => {
      const rows = await txt(`${selector}._domainkey.${domain}`);
      return { selector, who, rows };
    }),
  );
  for (const { selector, who, rows } of probes) {
    if (rows.length) {
      const isKey = rows.some((r) => /(?:^|;)\s*(?:p=|v=DKIM1)/i.test(r));
      if (isKey) {
        found.push(selector);
        process.stdout.write(`    ${selector}._domainkey  ${c.dim}(${who})${c.reset}\n`);
      }
    }
  }
  if (!found.length) {
    line('fatal', '没有任何 DKIM 公钥：你发出去的每一封信都无法用本域名签名，DMARC 只能靠 SPF 单腿站立');
  } else {
    line('ok', `已启用 DKIM selector：${found.join(', ')}`);
    const cfOnly = found.every((s) => s.startsWith('cf2024'));
    if (cfOnly) line('warn', '只有 Cloudflare 转发用的 selector，它签的是"转发件"，不是你发出的信');
    if (expect) {
      const foreign = found.filter((s) => EXPECTATIONS[expect].foreignDkim.some((f) => s.startsWith(f)));
      if (foreign.length) line('warn', `仍残留旧 selector（${foreign.join(', ')}），确认不再使用后可清理`);
    }
  }

  // ---------- 4. DMARC ----------
  process.stdout.write(`\n${c.bold}DMARC（策略 + 报告）${c.reset}\n`);
  const dmarcRows = (await txt(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r));
  if (!dmarcRows.length) {
    line('fatal', '没有 DMARC 记录：别人可以随便伪造你的域名，你也不会收到任何报告');
  } else if (dmarcRows.length > 1) {
    line('fatal', `存在 ${dmarcRows.length} 条 DMARC 记录，必须只留一条`);
  } else {
    const rec = dmarcRows[0];
    process.stdout.write(`    ${rec}\n`);
    const p = tagValue(rec, 'p');
    const rua = tagValue(rec, 'rua');
    const sp = tagValue(rec, 'sp');
    if (!p) line('fatal', 'DMARC 缺少 p= 策略');
    else if (p.toLowerCase() === 'none') line('warn', 'p=none 只观察不拦截；确认 DKIM 通过后应升级到 quarantine → reject');
    else line('ok', `策略 p=${p}${sp ? ` / sp=${sp}` : ''}`);

    if (!rua) line('warn', '没有 rua= 报告地址，等于盲飞：进垃圾箱/被伪造都不会有人告诉你');
    else line('ok', `报告接收方 rua=${rua}`);

    if (expect && p && p.toLowerCase() === 'none') line('warn', '迁移完成后建议把 p= 升到 quarantine 以上');
  }

  // ---------- 5. 事务邮件通道（Resend 等） ----------
  process.stdout.write(`\n${c.bold}事务邮件通道（send 子域，验证码 / 简历投递 / 留言通知）${c.reset}\n`);
  const sendSpf = spfOf(await txt(`send.${domain}`));
  const sendMx = await mx(`send.${domain}`);
  if (!sendSpf.length && !sendMx.length) {
    process.stdout.write(`    ${c.dim}- 未配置独立发信子域（事务邮件与人工邮件共用根域信誉）${c.reset}\n`);
  } else {
    if (sendSpf.length === 1) line('ok', `send 子域 SPF：${sendSpf[0]}`);
    else if (sendSpf.length > 1) line('fatal', 'send 子域有多条 SPF，必须合并');
    else line('warn', 'send 子域没有 SPF，退信处理会走不通');
    if (sendMx.length) line('ok', `send 子域 MX（接收退信）：${sendMx.map((r) => r.exchange).join(', ')}`);
    else line('warn', 'send 子域没有 MX，退信（bounce）无处可去，会污染发信域');
  }

  // ---------- 6. 附属记录 ----------
  process.stdout.write(`\n${c.bold}附属记录（可选，但有加分）${c.reset}\n`);
  const mtaSts = (await txt(`_mta-sts.${domain}`)).filter((r) => /^v=STSv1/i.test(r));
  if (mtaSts.length) {
    const id = tagValue(mtaSts[0], 'id');
    const policy = await withTimeout(resolver.resolve4(`mta-sts.${domain}`)).catch(() => []);
    if (!policy.length) line('warn', `有 _mta-sts 记录但 mta-sts.${domain} 没有 A 记录，策略取不到等于没配`);
    else line('ok', `MTA-STS 已启用（id=${id ?? '未填'}）`);
  } else {
    process.stdout.write(`    ${c.dim}- 未配置 MTA-STS（可选）${c.reset}\n`);
  }

  const tlsRpt = (await txt(`_smtp._tls.${domain}`)).filter((r) => /^v=TLSRPTv1/i.test(r));
  if (tlsRpt.length) line('ok', 'TLS-RPT 已启用');
  else process.stdout.write(`    ${c.dim}- 未配置 TLS-RPT（可选）${c.reset}\n`);

  // ---------- 汇总 ----------
  process.stdout.write(`\n${c.bold}汇总${c.reset}\n`);
  process.stdout.write(`    通过 ${c.green}${problems.ok.length}${c.reset} · 告警 ${c.yellow}${problems.warn.length}${c.reset} · 致命 ${c.red}${problems.fatal.length}${c.reset}\n`);

  if (problems.fatal.length) {
    process.stdout.write(`\n${c.red}${c.bold}必须处理：${c.reset}\n`);
    problems.fatal.forEach((m) => process.stdout.write(`  - ${m}\n`));
    process.stdout.write(`\n处置步骤见 docs/email-deliverability.md「迁移 Runbook」一节。\n\n`);
    return 2;
  }
  if (problems.warn.length) {
    process.stdout.write(`\n${c.yellow}建议处理：${c.reset}\n`);
    problems.warn.forEach((m) => process.stdout.write(`  - ${m}\n`));
    process.stdout.write('\n');
    return 1;
  }
  process.stdout.write(`\n${c.green}${c.bold}全部通过。${c.reset}\n\n`);
  return 0;
}

main()
  .then((code) => {
    // 用 exitCode 而不是 process.exit()，避免管道下 stdout 缓冲区被截断
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`体检失败：${err?.message || err}\n`);
    process.exitCode = 2;
  });
