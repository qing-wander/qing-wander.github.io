'use strict';

/**
 * 数字分身问答 —— 云函数入口（腾讯云 CloudBase，Node.js 运行时）
 *
 * 职责：CORS 白名单 → 限流 → 意图拦截 → TF-IDF 检索（与 knowledge/ 产物同源）
 *      → 组装提示词 → 调 CloudBase 内置大模型网关 → 返回 JSON + 结构化日志。
 *
 * 三种请求：
 *   POST { question }           简历问答（≤200 字，20 次/分钟、200 次/天）
 *   POST { mode: 'jd', jd }     岗位匹配（≤1500 字，10 分钟 4 次、20 次/天）
 *                               输出固定结构的对照表，见 prompt.js buildJDSystem
 *   POST { mode: 'tts', text }  语音合成（≤150 字，走腾讯云 TTS 免费包）
 *                               返回 base64 mp3，见 tts.js / docs/ai-voice-survey.md 第 7 节
 *
 * 零第三方依赖：只用 Node 内置 https / crypto / fs。
 * 知识库随包部署在 ./kb/，由 scripts/build_kb.py --sync-functions 生成。
 *
 * 环境变量：
 *   AI_API_KEY       必填，CloudBase「服务端 API Key」（只放平台环境变量，不进代码）
 *   AI_BASE_URL      可选，默认本环境 AI 网关
 *   AI_MODEL         可选，默认 hy3（体验版唯一可套餐抵扣的模型）
 *   ALLOWED_ORIGINS  可选，逗号分隔，默认 shenge-work.github.io 与 shenge-work.pages.dev（含 *.shenge-work.pages.dev 预览子域）；支持 "*." 前缀通配后缀
 *   LOG_ENABLED      可选，默认 true；置 false 则既不打日志也不落库
 *   LOG_SALT         可选，IP 盐化用
 *   LOG_RETENTION_DAYS 可选，默认 30（懒清理：写库时按 5% 概率触发删除过期行）
 *   RDB_LOG_URL      可选，默认本环境 PostgREST 的 chat_logs 端点
 *   TTS_SECRET_ID / TTS_SECRET_KEY / TTS_TOKEN  可选，腾讯云 TTS 密钥；
 *                    缺省时自动尝试 SCF 运行角色的临时密钥环境变量
 *   TTS_VOICE_TYPE / TTS_REGION                 可选，默认 101001 / ap-shanghai
 */

var https = require('https');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var promptLib = require('./prompt.js');
var ttsLib = require('./tts.js');

var KB_DIR = path.join(__dirname, 'kb');

var AI_BASE = (process.env.AI_BASE_URL ||
  'https://resume-ai-d9g7zghnxda2ee2cb.api.tcloudbasegateway.com/v1/ai/cloudbase').replace(/\/+$/, '');
// 优先读平台「API Key 设置」自动注入的 CLOUDBASE_APIKEY，其次才是手工配置的 AI_API_KEY
var AI_KEY = process.env.AI_API_KEY || process.env.CLOUDBASE_APIKEY || '';
var AI_MODEL = process.env.AI_MODEL || 'hy3';
var LOG_ENABLED = String(process.env.LOG_ENABLED || 'true') !== 'false';
/* IP 盐值：优先用显式配置；没配也不能退回固定常量（固定盐等于可逆向的伪匿名）。
   退路依次是「由部署密钥派生」（同一部署内稳定、外部不可猜）和「实例级随机」。
   实例级随机意味着冷启动后 ip_hash 会变，跨实例的日均计数随之重置——这是隐私优先的取舍。 */
var LOG_SALT = (function () {
  var explicit = String(process.env.LOG_SALT || '').trim();
  if (explicit) return explicit;
  if (AI_KEY) return 'ak|' + crypto.createHash('sha256').update(String(AI_KEY)).digest('hex').slice(0, 24);
  return 'ephemeral|' + crypto.randomBytes(12).toString('hex');
})();

// D6 日志落库：PG 模式环境自动暴露 PostgREST，直接 POST 一行 payload(jsonb)，无需引入 SDK
var RDB_LOG_URL = process.env.RDB_LOG_URL ||
  'https://resume-ai-d9g7zghnxda2ee2cb.api.tcloudbasegateway.com/v1/rdb/rest/chat_logs';
var LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 30);
var LOG_PURGE_GAP_MS = 60 * 60 * 1000;   // 每个实例每小时最多清理一次
var lastPurgeAt = 0;

var DEFAULT_ORIGINS = [
  'https://shenge-work.github.io',
  'https://shenge-work.pages.dev',
  '*.shenge-work.pages.dev',   // Cloudflare Pages 预览部署：https://<commit>.shenge-work.pages.dev
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];
var ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
  .split(',').map(function (s) { return s.trim(); }).filter(Boolean);

// 白名单匹配：支持精确匹配，以及 "*." 前缀的通配后缀（如 *.shenge-work.pages.dev）
function isAllowedOrigin(origin) {
  var o = String(origin || '').trim();
  if (!o) return false;
  var host = o.replace(/^https?:\/\//, '');
  for (var i = 0; i < ALLOWED_ORIGINS.length; i++) {
    var rule = ALLOWED_ORIGINS[i];
    if (rule === o) return true;
    if (rule.indexOf('*.') === 0) {
      var suffix = rule.slice(1);   // ".shenge-work.pages.dev"
      if (host.length > suffix.length && host.slice(-suffix.length) === suffix) return true;
    }
  }
  return false;
}

// 回给浏览器的默认来源必须是具体域名，不能是通配规则
function fallbackOrigin() {
  for (var i = 0; i < ALLOWED_ORIGINS.length; i++) {
    if (ALLOWED_ORIGINS[i].indexOf('*.') !== 0) return ALLOWED_ORIGINS[i];
  }
  return '';
}

var MAX_QUESTION_CHARS = 200;
var TOP_K = 4;
var SCORE_FLOOR = 0.05;         // 绝对下限：低于它连"弱相关"都算不上，交给关键词兜底
var SCORE_KEEP_RATIO = 0.4;     // 相对下限：只保留接近 top1 的块，避免"矮子里拔将军"
var MAX_ANSWER_CHARS = 700;
var RATE_WINDOW_MS = 60 * 1000;
var RATE_LIMIT_PER_WINDOW = 20;
var RATE_LIMIT_PER_DAY = 200;
/* 全站兜底额度：IP 维度可以被伪造/轮换绕过，这条不按 IP，只防「整站被打爆」 */
var GLOBAL_LIMIT_PER_DAY = Number(process.env.GLOBAL_LIMIT_PER_DAY || 600);

// JD 匹配（mode: 'jd'）：长文本 + 生成一整张表，成本高于单次问答，单独设一档额度
var MIN_JD_CHARS = 30;
var MAX_JD_CHARS = 1500;
var JD_TOP_CHUNKS = 6;          // 送进提示词的档案切片数（全库 37 段）
var JD_MAX_ROWS = 10;           // 对照表最多几行，与提示词约束一致
var JD_LIMIT_WINDOW_MS = 10 * 60 * 1000;
var JD_LIMIT_PER_WINDOW = 4;    // 每 IP 10 分钟 4 次
var JD_LIMIT_PER_DAY = 20;

// TTS：按句合成，一次回答会连发数条请求，额度比问答宽，但字符是真金白银，独立收一道
var TTS_LIMIT_WINDOW_MS = 60 * 1000;
var TTS_LIMIT_PER_WINDOW = 40;  // 每 IP 每分钟 40 段（约 10 次完整回答）
var TTS_LIMIT_PER_DAY = 400;
var TTS_MAX_TEXT_CHARS = ttsLib.maxChars;

// ---------------------------------------------------------------- 知识库装载

var KB = null;

function loadKB() {
  if (KB) return KB;
  var chunks = JSON.parse(fs.readFileSync(path.join(KB_DIR, 'chunks.json'), 'utf8'));
  var vectors = JSON.parse(fs.readFileSync(path.join(KB_DIR, 'vectors.json'), 'utf8'));
  var meta = JSON.parse(fs.readFileSync(path.join(KB_DIR, 'kb-meta.json'), 'utf8'));
  if (meta.provider !== 'tfidf') {
    throw new Error('kb provider 不受支持：' + meta.provider + '（函数端仅实现 tfidf 口径）');
  }
  var vidx = Object.create(null);
  for (var i = 0; i < meta.vocab.length; i++) vidx[meta.vocab[i]] = i;
  var byId = Object.create(null);
  for (var j = 0; j < chunks.length; j++) byId[chunks[j].id] = chunks[j];
  KB = {
    chunks: chunks,
    byId: byId,
    items: vectors.items,
    idf: meta.idf,
    vidx: vidx,
    scale: meta.quant.scale,
    dim: meta.dim,
    count: meta.count
  };
  return KB;
}

// ---------------------------------------------------------------- 分词与检索
// 与 scripts/build_kb.py 的 tokenize / fit_tfidf / quantize_int8 严格同口径

var CJK_RE = /[\u4e00-\u9fff]+/g;
var WORD_RE = /[a-z0-9][a-z0-9+#./]*/g;

function tokenize(text) {
  var out = [];
  var low = String(text || '').toLowerCase();
  var m;
  CJK_RE.lastIndex = 0;
  while ((m = CJK_RE.exec(low)) !== null) {
    var s = m[0];
    if (s.length === 1) {
      out.push(s);
    } else {
      for (var i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2));
    }
  }
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(low)) !== null) {
    var w = m[0].replace(/^[.\/-]+/, '').replace(/[.\/-]+$/, '');
    if (w.length >= 2) out.push('#' + w);
  }
  return out;
}

/** 查询向量（L2 归一化），返回 { vec, hits, terms } */
function queryVector(text, kb) {
  var toks = tokenize(text);
  var cnt = Object.create(null);
  var total = 0;
  for (var i = 0; i < toks.length; i++) {
    var idx = kb.vidx[toks[i]];
    if (idx !== undefined) {
      cnt[idx] = (cnt[idx] || 0) + 1;
      total++;
    }
  }
  var vec = new Float64Array(kb.dim);
  for (var k in cnt) vec[Number(k)] = (cnt[k] / (total || 1)) * kb.idf[Number(k)];
  var norm = 0;
  for (var j = 0; j < vec.length; j++) norm += vec[j] * vec[j];
  norm = Math.sqrt(norm);
  if (norm > 0) for (var n = 0; n < vec.length; n++) vec[n] = vec[n] / norm;
  return { vec: vec, hits: total, terms: toks };
}

/** 标题命中加权：块标题（项目名/公司名）是简历检索里最强的信号 */
function titleBoost(terms, title) {
  if (!terms || !terms.length) return 1;
  var low = String(title || '').toLowerCase();
  var seen = Object.create(null);
  var matched = 0;
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i].charAt(0) === '#' ? terms[i].slice(1) : terms[i];
    if (!t || seen[t]) continue;
    seen[t] = 1;
    if (low.indexOf(t) !== -1) matched++;
  }
  if (!matched) return 1;
  return Math.min(1.45, 1 + 0.12 * matched);
}

/** 关键词兜底：按 query bigram 在块内的命中比例打分（与前端 provider=none 同一算法） */
function keywordScore(text, kb, topk) {
  var raw = tokenize(text);
  if (!raw.length) return [];
  /* 去重：同一 bigram 重复出现不代表更强相关；单字命中也不足为据 */
  var seen = Object.create(null);
  var terms = [];
  for (var s = 0; s < raw.length; s++) {
    if (seen[raw[s]]) continue;
    seen[raw[s]] = 1;
    terms.push(raw[s]);
  }
  var minHits = Math.min(2, terms.length);
  var hits = [];
  for (var i = 0; i < kb.chunks.length; i++) {
    var low = String(kb.chunks[i].text).toLowerCase();
    var n = 0;
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      if (term.charAt(0) === '#') term = term.slice(1);
      if (term && term.length > 1 && low.indexOf(term) !== -1) n++;
    }
    if (n >= minHits && n) hits.push({ score: n / terms.length, id: kb.chunks[i].id });
  }
  hits.sort(function (a, b) { return b.score - a.score; });
  return hits.slice(0, topk || TOP_K);
}

/**
 * 章节意图：简历问答里「教育背景 / 联系方式 / 技术栈」这类词，在切片正文里往往
 * 根本没有同名字面（education 段写的是学校名和课程），纯词面检索必然落空。
 * 这里把常见问法映射到切片的 section，命中时给一个小加成，兜住这类"词面缺口"。
 */
var SECTION_HINTS = [
  { section: 'education', terms: ['教育', '学历', '毕业', '院校', '大学', '奖学金', '成绩'] },
  { section: 'contact', terms: ['联系', '邮箱', '邮件', '微信', '电话'] },
  { section: 'skills', terms: ['技能', '技术栈', '会什么', '语言', '框架', '工具'] },
  { section: 'awards', terms: ['证书', '获奖', '荣誉', '职称'] },
  { section: 'works', terms: ['作品', '开源', '个人项目', '作品集'] },
  { section: 'projects', terms: ['项目', '系统', '架构', '业务'] },
  { section: 'experience', terms: ['工作', '公司', '任职', '在职', '离职', '经历'] },
  { section: 'about', terms: ['自我介绍', '你是谁', '简单介绍'] }
];
var SECTION_BONUS = 0.06;

function sectionHint(text) {
  var low = String(text || '').toLowerCase();
  for (var i = 0; i < SECTION_HINTS.length; i++) {
    var terms = SECTION_HINTS[i].terms;
    for (var j = 0; j < terms.length; j++) {
      if (low.indexOf(terms[j]) !== -1) return SECTION_HINTS[i].section;
    }
  }
  return '';
}

/**
 * 检索：稀疏点积 + 标题加权 + 章节意图 → 去掉 0 分块 → 绝对/相对双阈值 → Top-K。
 * opts.relaxed 给 JD 逐条召回用：单条需求往往只有两三个词，按问答口径会被卡掉。
 */
function retrieve(question, opts) {
  var kb = loadKB();
  var relaxed = !!(opts && opts.relaxed);
  var q = queryVector(question, kb);
  var hint = sectionHint(question);
  var top = [];
  if (q.hits > 0 || hint) {
    for (var i = 0; i < kb.items.length; i++) {
      var item = kb.items[i];
      var s = 0;
      for (var k = 0; k < item.idx.length; k++) s += q.vec[item.idx[k]] * (item.val[k] / kb.scale);
      var ch = kb.byId[item.id];
      if (!ch) continue;
      if (hint && ch.section === hint) s += SECTION_BONUS;   // 词面缺口：靠章节意图兜住
      if (s <= 0) continue;                                  // 0 分块没有信息量，绝不放进"依据"
      s = s * titleBoost(q.terms, ch.title);
      top.push({ score: s, id: item.id });
    }
    top.sort(function (a, b) { return b.score - a.score; });
    var best = top.length ? top[0].score : 0;
    var absFloor = relaxed ? 0.04 : SCORE_FLOOR;
    var keepFloor = Math.max(absFloor, best * (relaxed ? 0.3 : SCORE_KEEP_RATIO));
    if (best < absFloor) {
      top = [];
    } else {
      top = top.filter(function (h) { return h.score >= keepFloor; }).slice(0, TOP_K);
    }
  }
  if (!top.length) {
    var kw = keywordScore(question, kb, TOP_K);
    if (!kw.length) return { hits: [], fallback: true, top1: 0, vocabHits: q.hits };
    return { hits: kw, fallback: true, top1: kw[0].score, vocabHits: q.hits };
  }
  return { hits: top, fallback: false, top1: top[0].score, vocabHits: q.hits };
}

// ---------------------------------------------------------------- JD 匹配
// 招聘方视角：JD → 需求条目 → 逐条召回档案切片 → 约束模型输出对照表。
// 与问答共用同一份 kb、同一套 TF-IDF 口径，不引入第二条检索链路。

/** 把 JD 拆成需求条目：按行 / 分号切，去掉序号与项目符号，去重后最多 14 条 */
function splitRequirements(jd) {
  var lines = String(jd || '').replace(/\r/g, '').split(/\n+/);
  var out = [];
  var seen = Object.create(null);
  for (var i = 0; i < lines.length; i++) {
    var segs = lines[i].split(/[；;]/);
    for (var j = 0; j < segs.length; j++) {
      var s = segs[j]
        .replace(/^\s*(?:[-•·*—]|\(?\d{1,2}[.、)）]|[（(]\d{1,2}[)）])\s*/, '')
        .replace(/\s+/g, ' ')
        .replace(/[。，,、：:]+$/, '')
        .trim();
      if (s.length < 4) continue;
      if (s.length > 90) s = s.slice(0, 90);
      var key = s.toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(s);
      if (out.length >= 14) return out;
    }
  }
  return out;
}

function mergeHits(into, hits) {
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    var s = h.score * jdChunkWeight(h.id);
    if (into[h.id] == null || s > into[h.id]) into[h.id] = s;
  }
}

/** 对照表要的是「可验证的证据」，不是自我介绍：
 *  同等相关度下优先项目 / 工作经历切片，个人概要与教育、证书、联系方式往后排。 */
function jdChunkWeight(id) {
  if (/^proj-|^exp-|^work-/.test(id)) return 1;
  if (/^skills-/.test(id)) return 0.8;
  if (/^me-/.test(id)) return 0.55;
  if (/^awards-/.test(id)) return 0.45;
  if (/^edu-/.test(id)) return 0.4;
  if (/^contact-/.test(id)) return 0.1;
  return 0.8;
}

/** 逐条需求召回 + 整段 JD 兜底召回，按最高分去重取前 N 段 */
function retrieveForJD(jd, requirements) {
  var merged = Object.create(null);
  for (var i = 0; i < requirements.length; i++) {
    mergeHits(merged, retrieve(requirements[i], { relaxed: true }).hits);
  }
  mergeHits(merged, retrieve(String(jd).slice(0, 600), { relaxed: true }).hits);
  var list = [];
  for (var id in merged) list.push({ id: id, score: merged[id] });
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, JD_TOP_CHUNKS);
}

/** 证据与原文的二元组重合度：用来在返回里标注「可回溯程度」，不参与筛选 */
function groundRatio(point, text) {
  var terms = tokenize(point);
  if (!terms.length) return 0;
  var low = String(text || '').toLowerCase();
  var hit = 0;
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i].charAt(0) === '#' ? terms[i].slice(1) : terms[i];
    if (t && low.indexOf(t) !== -1) hit++;
  }
  return Number((hit / terms.length).toFixed(2));
}

function oneLine(v, max) {
  var s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max) + '…';
  return s;
}

/** JD 留痕只存哈希：正文不入库，与页面对外承诺一致（也便于按同一份 JD 做去重统计） */
function jdTag(jd) {
  return 'jd:' + crypto.createHash('sha256').update(String(jd || '')).digest('hex').slice(0, 10);
}

/** 模型可能把 [proj-p02-03] 或标题当成 src，两种都认，认不出就不收这条证据 */
function findChunk(kb, src) {
  var key = String(src || '').trim().replace(/^[\[\s]+|[\]\s]+$/g, '');
  if (!key) return null;
  if (kb.byId[key]) return kb.byId[key];
  for (var id in kb.byId) {
    var t = String(kb.byId[id].title || '');
    if (t === key || t.indexOf(key) === 0) return kb.byId[id];
  }
  return null;
}

var JD_STATUSES = { covered: 1, partial: 1, gap: 1 };
var JD_STATUS_ALIAS = { '覆盖': 'covered', '已覆盖': 'covered', '部分': 'partial', '部分覆盖': 'partial', '缺口': 'gap', '未覆盖': 'gap' };

/**
 * 解析并收紧模型输出：非法 JSON 直接判失败（前端提示重试），
 * 合法但越界的内容逐项裁剪——行数、字数、状态枚举、证据 id 都必须落在白名单里。
 */
function parseJDAnswer(text, kb) {
  var raw = String(text || '').trim();
  if (!raw) return null;
  raw = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  var start = raw.indexOf('{');
  var end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  var obj = null;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.rows)) return null;

  var overall = obj.overall || {};
  var score = Number(overall.score);
  if (!isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  var verdict = oneLine(overall.verdict, 12);
  if (['强匹配', '匹配', '部分匹配', '不匹配', '无法判断'].indexOf(verdict) < 0) {
    verdict = score >= 80 ? '强匹配' : score >= 60 ? '匹配' : score >= 35 ? '部分匹配' : '不匹配';
  }

  var rows = [];
  var stats = { covered: 0, partial: 0, gap: 0 };
  for (var i = 0; i < obj.rows.length && rows.length < JD_MAX_ROWS; i++) {
    var r = obj.rows[i] || {};
    var req = oneLine(r.req, 80);
    if (!req) continue;
    var status = String(r.status || '').toLowerCase();
    if (JD_STATUS_ALIAS[status]) status = JD_STATUS_ALIAS[status];
    if (!JD_STATUSES[status]) status = 'partial';

    var evidence = [];
    var list = Array.isArray(r.evidence) ? r.evidence : [];
    for (var j = 0; j < list.length && evidence.length < 2; j++) {
      var e = list[j];
      if (typeof e === 'string') e = { point: e };
      if (!e || typeof e !== 'object') continue;
      var point = oneLine(e.point, 120);
      var chunk = findChunk(kb, e.src);
      if (!point || !chunk) continue;      // 拿不到原文出处的证据一律不收
      evidence.push({
        src: chunk.id,
        title: oneLine(chunk.title, 48),
        point: point,
        ground: groundRatio(point, chunk.text)
      });
    }
    if (status === 'covered' && !evidence.length) status = 'partial';

    rows.push({
      req: req,
      status: status,
      evidence: evidence,
      gap: status === 'covered' ? '' : oneLine(r.gap, 90),
      probe: oneLine(r.probe, 70)
    });
    stats[status]++;
  }
  if (!rows.length) return null;

  return {
    overall: { score: score, verdict: verdict, summary: oneLine(overall.summary, 200) },
    rows: rows,
    stats: stats
  };
}

// ---------------------------------------------------------------- 模型调用

function postJSON(urlStr, headers, payloadObj, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var u = new URL(urlStr);
    var body = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    headers['Content-Length'] = body.length;
    var req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', headers: headers, timeout: timeoutMs },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(text); } catch (e) { /* 保留原文 */ }
          resolve({ status: res.statusCode, text: text, json: json });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('upstream timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function callModel(systemPrompt, history, question, opts) {
  opts = opts || {};
  var messages = [{ role: 'system', content: systemPrompt }];
  var h = Array.isArray(history) ? history.slice(-4) : [];
  for (var i = 0; i < h.length; i++) {
    var m = h[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    var c = promptLib.scrub(String(m.content || '')).slice(0, 400);
    if (c) messages.push({ role: m.role, content: c });
  }
  messages.push({ role: 'user', content: question });

  return postJSON(
    AI_BASE + '/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_KEY },
    {
      model: AI_MODEL,
      messages: messages,
      max_tokens: opts.maxTokens || 800,
      temperature: opts.temperature == null ? 0.3 : opts.temperature,
      thinking: { type: 'disabled' }   // 实测关思考：reasoning_tokens 归零，延迟与成本都显著下降
    },
    opts.timeoutMs || 25000
  );
}

function extractAnswer(resp) {
  if (!resp.json) return '';
  var ch = (resp.json.choices && resp.json.choices[0]) || null;
  if (!ch || !ch.message) return '';
  return String(ch.message.content || '').trim();
}

// ---------------------------------------------------------------- 限流
// 两级：实例内存计数（快、零成本）+ 超阈值后查 PG 做跨实例精确计数。
// 平台侧网关限频（资源维度/客户端维度）在免费体验版不可用（点了直接弹升级），
// 而内存计数在多实例/冷启动下会重置，所以补一层数据库计数兜底。

var buckets = Object.create(null);
var RATE_DB_CHECK_AT = 8;            // 本实例窗口内超过 8 次，才去查库

function rateLimited(key) {
  var now = Date.now();
  var b = buckets[key];
  if (!b || now - b.windowStart > RATE_WINDOW_MS) {
    b = buckets[key] = { windowStart: now, windowCount: 0, dayStart: now, dayCount: 0 };
  }
  if (now - b.dayStart > 24 * 60 * 60 * 1000) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  b.windowCount++;
  b.dayCount++;
  return {
    blocked: b.windowCount > RATE_LIMIT_PER_WINDOW || b.dayCount > RATE_LIMIT_PER_DAY,
    reason: b.windowCount > RATE_LIMIT_PER_WINDOW ? 'window_mem' : 'day_mem',
    count: b.windowCount
  };
}

// 库里数最近 60 秒该 ip_hash 的行数（写日志时就落了这个字段，顺带复用）
async function countRecentByDb(iph) {
  if (!AI_KEY || typeof fetch !== 'function') return null;
  try {
    var since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    var url = RDB_LOG_URL +
      '?ip_hash=eq.' + encodeURIComponent(iph) +
      '&created_at=gt.' + encodeURIComponent(since) +
      '&select=id';
    var r = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + AI_KEY,
        'Prefer': 'count=exact',
        'Range-Unit': 'items',
        'Range': '0-0'
      }
    });
    if (r.status >= 300) return null;
    var cr = r.headers.get('content-range') || '';   // 形如 "0-0/37"
    var total = Number(String(cr).split('/')[1]);
    return isFinite(total) ? total : null;
  } catch (e) {
    return null;   // 查库失败一律放行，不能因为数据库抖动把访客挡在门外
  }
}

async function rateCheck(iph) {
  var mem = rateLimited(iph);
  if (mem.blocked) return mem;
  if (mem.count > RATE_DB_CHECK_AT) {
    var dbCount = await countRecentByDb(iph);
    if (dbCount != null && dbCount > RATE_LIMIT_PER_WINDOW) {
      return { blocked: true, reason: 'window_db', count: dbCount };
    }
  }
  return { blocked: false, count: mem.count };
}

/* 全站日额度：IP 维度可能被伪造，这条不按 IP，只在整站被刷爆时熔断 */
var globalBucket = { dayKey: '', count: 0 };

function globalQuota() {
  var day = new Date().toISOString().slice(0, 10);
  if (globalBucket.dayKey !== day) {
    globalBucket.dayKey = day;
    globalBucket.count = 0;
  }
  globalBucket.count++;
  return { blocked: globalBucket.count > GLOBAL_LIMIT_PER_DAY, count: globalBucket.count };
}

// JD 匹配在问答限流之外再收一道：一次请求要读完 1500 字并生成整张表，
// 成本是单次问答的数倍，只靠 20 次/分钟挡不住脚本刷额度。
var jdBuckets = Object.create(null);

function jdQuota(key) {
  var now = Date.now();
  var b = jdBuckets[key];
  if (!b || now - b.windowStart > JD_LIMIT_WINDOW_MS) {
    b = jdBuckets[key] = { windowStart: now, count: 0, dayStart: now, dayCount: 0 };
  }
  if (now - b.dayStart > 24 * 60 * 60 * 1000) {
    b.dayStart = now;
    b.dayCount = 0;
  }
  b.count++;
  b.dayCount++;
  return {
    blocked: b.count > JD_LIMIT_PER_WINDOW || b.dayCount > JD_LIMIT_PER_DAY,
    reason: b.count > JD_LIMIT_PER_WINDOW ? 'jd_window' : 'jd_day',
    count: b.count
  };
}

/**
 * 额度退款：解析失败 / 上游 5xx / 召回为空 都没拿到结果，不该记在用户头上。
 * 只退不减到负数，且窗口必须仍属于当前窗口（跨窗口时旧账已清零，无需退）。
 */
function jdQuotaRefund(key) {
  var b = jdBuckets[key];
  if (!b) return;
  if (Date.now() - b.windowStart > JD_LIMIT_WINDOW_MS) return;
  if (b.count > 0) b.count--;
  if (b.dayCount > 0) b.dayCount--;
}

// ---------------------------------------------------------------- HTTP 适配

function headerOf(headers, name) {
  if (!headers) return '';
  var lower = name.toLowerCase();
  for (var k in headers) {
    if (String(k).toLowerCase() === lower) return String(headers[k] || '');
  }
  return '';
}

/**
 * 取客户端 IP：
 * 1) 平台注入的单值头（x-real-ip / x-client-ip / cf-connecting-ip）最可信；
 * 2) X-Forwarded-For 只认**最后一跳**（网关追加的那一段），首段是客户端自填的，可伪造；
 * 3) 都没有才退回运行时给的 clientIP。
 */
function clientIp(event, headers) {
  var direct = headerOf(headers, 'x-real-ip') ||
    headerOf(headers, 'x-client-ip') ||
    headerOf(headers, 'cf-connecting-ip');
  if (direct) return String(direct).split(',')[0].trim();
  var xff = headerOf(headers, 'x-forwarded-for');
  if (xff) {
    var list = String(xff).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (list.length) return list[list.length - 1];
  }
  return event.clientIP || event.clientIp || 'unknown';
}

function ipHash(ip) {
  return crypto.createHash('sha256').update(String(ip) + '|' + LOG_SALT).digest('hex').slice(0, 16);
}

function corsHeaders(origin) {
  var allow = isAllowedOrigin(origin) ? String(origin).trim() : fallbackOrigin();
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

function reply(status, origin, obj) {
  return {
    statusCode: status,
    headers: corsHeaders(origin),
    body: JSON.stringify(obj),
    isBase64Encoded: false
  };
}

function parseBody(event) {
  var raw = event.body;
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  var text = String(raw);
  if (event.isBase64Encoded) text = Buffer.from(text, 'base64').toString('utf8');
  try { return JSON.parse(text); } catch (e) { return null; }
}

function logLine(obj) {
  if (!LOG_ENABLED) return;
  try { console.log('[chat_log] ' + JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
  logToDb(obj);
}

// 落库失败绝不影响主链路：一律 fire-and-forget，异常只打一行控制台
function logToDb(obj) {
  if (!LOG_ENABLED || !AI_KEY || typeof fetch !== 'function') return;
  try {
    var q = promptLib.scrub(String(obj.q || '')).slice(0, 300);
    var a = promptLib.scrub(String(obj.a || '')).slice(0, 800);
    var payload = {
      q: q,
      a: a,
      question_len: q.length,
      answer_len: a.length,
      tag: obj.tag || null,
      top_ids: obj.top_ids || [],
      top1_score: obj.top1_score == null ? null : Number(obj.top1_score),
      fallback: !!obj.fallback,
      latency_ms: obj.latency_ms == null ? null : Number(obj.latency_ms),
      model: obj.model || null,
      ip_hash: obj.ip_hash || null,
      origin: obj.origin || null,
      suspect: !!obj.suspect,
      blocked: obj.blocked || null,
      degraded: !!obj.degraded,
      model_called: obj.model_called == null ? null : !!obj.model_called
    };
    fetch(RDB_LOG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + AI_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ payload: payload })
    }).then(function (r) {
      if (r.status >= 300) console.log('[chat_log_db] http=' + r.status);
    }).catch(function (e) {
      console.log('[chat_log_db] err=' + (e && e.message ? e.message : 'unknown'));
    });
    if (Date.now() - lastPurgeAt > LOG_PURGE_GAP_MS) {
      lastPurgeAt = Date.now();
      purgeOldLogs();
    }
  } catch (e) { /* 忽略 */ }
}

// PG 没有原生 TTL：写入时低频顺手清掉 30 天前的行（DELETE ... created_at < cutoff）
function purgeOldLogs() {
  try {
    var cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400000).toISOString();
    fetch(RDB_LOG_URL + '?created_at=lt.' + encodeURIComponent(cutoff), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + AI_KEY, 'Prefer': 'return=minimal' }
    }).then(function (r) {
      console.log('[chat_log_purge] http=' + r.status);
    }).catch(function (e) {
      console.log('[chat_log_purge] err=' + (e && e.message ? e.message : 'unknown'));
    });
  } catch (e) { /* 忽略 */ }
}

// ---------------------------------------------------------------- JD 匹配主流程
// POST { mode: 'jd', jd: '...' } → { ok, match: { overall, rows, stats }, sources, meta }
// 与问答共用 origin 白名单、IP 盐化、两级限流与结构化日志，只是额度更紧。

async function handleJD(body, origin, iph, started) {
  var jd = String(body.jd || '').trim();
  if (jd.length < MIN_JD_CHARS) {
    return reply(400, origin, { ok: false, error: 'bad_request', message: 'JD 太短了，至少贴 ' + MIN_JD_CHARS + ' 字，才好逐条对照' });
  }
  if (jd.length > MAX_JD_CHARS) {
    return reply(400, origin, {
      ok: false, error: 'bad_request',
      message: 'JD 请控制在 ' + MAX_JD_CHARS + ' 字内（当前 ' + jd.length + ' 字），建议只保留岗位职责与任职要求'
    });
  }

  var rl = await rateCheck(iph);
  if (rl.blocked) {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: '', a: '', channel: 'tencent', tag: 'jd', blocked: 'rate_limited:' + rl.reason, count: rl.count });
    return reply(429, origin, { ok: false, error: 'rate_limited', message: '请求有点急，稍等几秒再试' });
  }
  var gq = globalQuota();
  if (gq.blocked) {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: '', a: '', channel: 'tencent', tag: 'jd', blocked: 'global_day', count: gq.count });
    return reply(429, origin, { ok: false, error: 'rate_limited', message: '今天的 JD 匹配额度用完了，明天再来，或直接邮件联系' });
  }

  /* JD 是文档不是提问：不做「越界/敏感」拦截（JD 里出现「薪资」很正常），
     只拦提示注入——它是唯一会改写上面系统规则的东西。
     注入检查放在额度扣减之前：被拦掉的请求不该占用人家的次数。 */
  var cls = promptLib.classifyInput(jd.slice(0, 300));
  if (cls.action === 'suspect') {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: jdTag(jd), a: '', channel: 'tencent', tag: 'jd', blocked: 'injection:' + cls.reason, latency_ms: Date.now() - started });
    return reply(400, origin, { ok: false, error: 'bad_request', message: 'JD 里包含指令性内容，已停止处理' });
  }

  var quota = jdQuota(iph);
  if (quota.blocked) {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: '', a: '', channel: 'tencent', tag: 'jd', blocked: 'jd_quota:' + quota.reason, count: quota.count });
    return reply(429, origin, {
      ok: false, error: 'jd_quota',
      message: 'JD 匹配每人 10 分钟内 4 次。急的话直接邮件：shenge.work@gmail.com'
    });
  }

  if (!AI_KEY) {
    jdQuotaRefund(iph);
    return reply(500, origin, { ok: false, error: 'server_misconfig', message: '函数缺少 AI_API_KEY 环境变量' });
  }

  var kb, requirements, top;
  try {
    kb = loadKB();
    requirements = splitRequirements(jd);
    top = retrieveForJD(jd, requirements);
  } catch (e) {
    jdQuotaRefund(iph);
    return reply(500, origin, { ok: false, error: 'kb_error', message: '知识库装载失败' });
  }

  var ctxChunks = [];
  var sources = [];
  for (var i = 0; i < top.length; i++) {
    var ch = kb.byId[top[i].id];
    if (!ch) continue;
    ctxChunks.push(ch);
    sources.push({ id: ch.id, title: ch.title, score: Number(top[i].score.toFixed(4)) });
  }
  if (!ctxChunks.length) {
    jdQuotaRefund(iph);
    logLine({ ts: started, origin: origin, ip_hash: iph, q: jdTag(jd), a: '', channel: 'tencent', tag: 'jd', latency_ms: Date.now() - started, model_called: false });
    return reply(200, origin, { ok: false, error: 'no_match', message: '档案里找不到与这份 JD 相关的资料，换个岗位试试' });
  }

  var answer = '';
  try {
    var resp = await callModel(
      promptLib.buildJDSystem(ctxChunks, jd),
      null,
      '按上面的 JSON 结构输出这份 JD 的对照结果。',
      { maxTokens: 1500, temperature: 0.2, timeoutMs: 26000 }
    );
    if (resp.status >= 200 && resp.status < 300) answer = extractAnswer(resp);
  } catch (e) {
    answer = '';
  }

  var match = answer ? parseJDAnswer(answer, kb) : null;
  if (!match) {
    jdQuotaRefund(iph);   // 模型没按结构输出属于我方失败，不占用户额度
    logLine({
      ts: started, origin: origin, ip_hash: iph, q: jdTag(jd), a: '',
      channel: 'tencent', tag: 'jd', top_ids: ctxChunks.map(function (c) { return c.id; }),
      top1_score: top.length ? top[0].score : 0, fallback: false,
      latency_ms: Date.now() - started, model_called: true, model: AI_MODEL, blocked: 'parse_failed'
    });
    return reply(502, origin, { ok: false, error: 'parse_failed', message: '这次模型没按结构输出，再点一次就好' });
  }

  logLine({
    ts: started, origin: origin, ip_hash: iph,
    q: jdTag(jd),
    a: match.overall.score + ' 分 / ' + match.overall.verdict,
    channel: 'tencent', tag: 'jd', top_ids: ctxChunks.map(function (c) { return c.id; }),
    top1_score: top.length ? top[0].score : 0, fallback: false,
    latency_ms: Date.now() - started, model_called: true, model: AI_MODEL
  });

  return reply(200, origin, {
    ok: true,
    mode: 'jd',
    match: match,
    sources: sources,
    meta: {
      jd_chars: jd.length,
      requirements: requirements.length,   // JD 拆出的原始条目数
      merged: match.rows.length,           // 对照表实际行数（同义需求已合并）
      recalled: ctxChunks.length,
      latency_ms: Date.now() - started
    }
  });
}

// ---------------------------------------------------------------- 语音合成（Phase 2）
// POST /chat { mode:'tts', text, kind } 或 POST /tts（若另外配了路径映射）
// → { ok, audio: base64 mp3, mime, cached, chars }
//
// 复用 /chat 的 Origin 白名单、IP 盐化与双窗口限流；密钥只在环境变量里。
// 前端 AIVoiceCloud 探测失败会自动回落到浏览器 SpeechSynthesis，用户无感。

var ttsBuckets = Object.create(null);

function ttsQuota(key) {
  var now = Date.now();
  var b = ttsBuckets[key];
  if (!b || now - b.windowStart > TTS_LIMIT_WINDOW_MS) {
    b = ttsBuckets[key] = { windowStart: now, count: 0, dayStart: now, dayCount: 0 };
  }
  if (now - b.dayStart > 24 * 60 * 60 * 1000) { b.dayStart = now; b.dayCount = 0; }
  b.count++;
  b.dayCount++;
  return {
    blocked: b.count > TTS_LIMIT_PER_WINDOW || b.dayCount > TTS_LIMIT_PER_DAY,
    reason: b.count > TTS_LIMIT_PER_WINDOW ? 'tts_window' : 'tts_day',
    count: b.count
  };
}

function replyTTS(status, origin, obj) {
  var out = reply(status, origin, obj);
  out.headers['Cache-Control'] = 'no-store';   // 音频不进 CDN 缓存
  return out;
}

function ttsLog(obj) {
  if (!LOG_ENABLED) return;
  try { console.log('[tts_log] ' + JSON.stringify(obj)); } catch (e) { /* 忽略 */ }
}

async function handleTTS(body, origin, iph, started) {
  var text = String(body.text || '').trim();
  if (!text) {
    return replyTTS(400, origin, { ok: false, error: 'bad_request', message: '缺少 text' });
  }
  if (text.length > TTS_MAX_TEXT_CHARS) {
    return replyTTS(400, origin, {
      ok: false, error: 'text_too_long',
      message: '单段文本请控制在 ' + TTS_MAX_TEXT_CHARS + ' 字内（当前 ' + text.length + ' 字）'
    });
  }

  var quota = ttsQuota(iph);
  if (quota.blocked) {
    ttsLog({ ts: started, origin: origin, ip_hash: iph, blocked: quota.reason, count: quota.count });
    return replyTTS(429, origin, { ok: false, error: 'rate_limited', message: '语音请求有点急，稍等几秒再试' });
  }

  if (!ttsLib.available()) {
    ttsLog({ ts: started, origin: origin, ip_hash: iph, error: 'tts_not_configured', chars: text.length });
    return replyTTS(503, origin, {
      ok: false, error: 'tts_not_configured',
      message: '云端语音未配置密钥，已自动使用浏览器语音'
    });
  }

  try {
    var r = await ttsLib.synth(text, { kind: String(body.kind || 'answer'), voice: body.voice });
    ttsLog({
      ts: started, origin: origin, ip_hash: iph, chars: r.chars, cached: r.cached,
      voice: r.voice, latency_ms: Date.now() - started
    });
    return replyTTS(200, origin, {
      ok: true,
      audio: r.audio,
      mime: r.mime,
      cached: !!r.cached,
      chars: r.chars,
      voice: r.voice,
      ai_generated: true   // 《AI 生成合成内容标识办法》：音频元数据标识
    });
  } catch (e) {
    var err = e || {};
    var code = String(err.code || err.message || 'unknown');
    ttsLog({
      ts: started, origin: origin, ip_hash: iph, chars: text.length,
      error: code.slice(0, 160), latency_ms: Date.now() - started
    });
    return replyTTS(502, origin, {
      ok: false, error: 'tts_failed',
      message: '云端语音暂时不可用，已自动使用浏览器语音',
      code: /^(tts_|Invalid|Unsupported|AuthFailure|LimitExceeded)/.test(code) ? code.slice(0, 80) : undefined
    });
  }
}

// ---------------------------------------------------------------- 主流程

exports.main = async function (event) {
  event = event || {};
  var headers = event.headers || {};
  var origin = headerOf(headers, 'origin');
  var method = String(event.httpMethod || event.method || 'POST').toUpperCase();
  var started = Date.now();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '', isBase64Encoded: false };
  }
  if (!isAllowedOrigin(origin)) {
    return reply(403, origin, { ok: false, error: 'origin_denied', message: '来源不在白名单' });
  }

  var body = parseBody(event);
  if (!body || typeof body !== 'object') {
    return reply(400, origin, { ok: false, error: 'bad_request', message: '请求体不是合法 JSON' });
  }

  var ip = clientIp(event, headers);
  var iph = ipHash(ip);

  /* 「岗位匹配」视图：POST { mode: 'jd', jd }。
     走同一套来源校验与 IP 盐化，但输入长度、额度、输出结构都是另一套。 */
  if (String(body.mode || '') === 'jd') {
    return handleJD(body, origin, iph, started);
  }

  /* 语音合成：线上 HTTP 触发路径只配了 /chat，因此用 body.mode 路由，
     不需要在控制台新增 /tts 路径映射；若日后单独配了 /tts 也一并识别。 */
  if (String(body.mode || '') === 'tts' || /\/tts(?:\?|\/|$)/.test(String(event.path || ''))) {
    return handleTTS(body, origin, iph, started);
  }

  var question = String(body.question || '').trim();
  if (!question) {
    return reply(400, origin, { ok: false, error: 'bad_request', message: '缺少 question' });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return reply(400, origin, { ok: false, error: 'bad_request', message: '问题太长了，请控制在 ' + MAX_QUESTION_CHARS + ' 字内' });
  }

  var rl = await rateCheck(iph);
  if (rl.blocked) {
    logLine({
      ts: started, origin: origin, ip_hash: iph, q: '', a: '', channel: 'tencent',
      tag: 'rate_limited', blocked: 'rate_limited:' + rl.reason, count: rl.count
    });
    return reply(429, origin, { ok: false, error: 'rate_limited', message: '问得有点快，稍等几秒再试' });
  }
  var gq = globalQuota();
  if (gq.blocked) {
    logLine({
      ts: started, origin: origin, ip_hash: iph, q: '', a: '', channel: 'tencent',
      tag: 'rate_limited', blocked: 'global_day', count: gq.count
    });
    return reply(429, origin, { ok: false, error: 'rate_limited', message: '今天的问答额度用完了，明天再来，或直接邮件联系' });
  }

  var cls = promptLib.classifyInput(question);
  var suspect = cls.action === 'suspect';
  if (cls.action === 'sensitive') {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: question, a: promptLib.SENSITIVE_REPLY, channel: 'tencent', top_ids: [], top1_score: 0, fallback: true, latency_ms: Date.now() - started, blocked: 'sensitive:' + cls.reason });
    return reply(200, origin, { ok: true, answer: promptLib.SENSITIVE_REPLY, sources: [], top1_score: 0, fallback: true });
  }
  if (cls.action === 'offtopic') {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: question, a: promptLib.OFFTOPIC_REPLY, channel: 'tencent', top_ids: [], top1_score: 0, fallback: true, latency_ms: Date.now() - started, blocked: 'offtopic:' + cls.reason });
    return reply(200, origin, { ok: true, answer: promptLib.OFFTOPIC_REPLY, sources: [], top1_score: 0, fallback: true });
  }

  var ret;
  try {
    ret = retrieve(question);
  } catch (e) {
    return reply(500, origin, { ok: false, error: 'kb_error', message: '知识库装载失败' });
  }

  if (!ret.hits.length) {
    logLine({ ts: started, origin: origin, ip_hash: iph, q: question, a: promptLib.NO_MATCH_REPLY, channel: 'tencent', top_ids: [], top1_score: 0, fallback: true, latency_ms: Date.now() - started, model_called: false, suspect: suspect });
    return reply(200, origin, { ok: true, answer: promptLib.NO_MATCH_REPLY, sources: [], top1_score: 0, fallback: true, no_match: true });
  }

  if (!AI_KEY) {
    return reply(500, origin, { ok: false, error: 'server_misconfig', message: '函数缺少 AI_API_KEY 环境变量' });
  }

  var kb = loadKB();
  var ctxChunks = [];
  var sources = [];
  for (var i = 0; i < ret.hits.length; i++) {
    var ch = kb.byId[ret.hits[i].id];
    if (!ch) continue;
    ctxChunks.push(ch);
    sources.push({ id: ch.id, title: ch.title, score: Number(ret.hits[i].score.toFixed(4)) });
  }

  var answer = '';
  try {
    var resp = await callModel(promptLib.buildSystem(ctxChunks), body.history, question);
    if (resp.status >= 200 && resp.status < 300) {
      answer = extractAnswer(resp);
    } else if (resp.json) {
      answer = '';
    }
  } catch (e) {
    answer = '';
  }

  if (!answer) {
    // 模型侧失败 → 纯检索降级：直接把最相关的知识块原文给出去，不让用户看到空白
    var fallbackText = (kb.byId[ret.hits[0].id] || {}).text || promptLib.NO_MATCH_REPLY;
    fallbackText = promptLib.scrub(fallbackText).slice(0, MAX_ANSWER_CHARS);
    logLine({ ts: started, origin: origin, ip_hash: iph, q: question, a: fallbackText, channel: 'tencent', top_ids: ret.hits.map(function (h) { return h.id; }), top1_score: ret.top1, fallback: true, latency_ms: Date.now() - started, model_called: true, degraded: true, suspect: suspect });
    return reply(200, origin, { ok: true, answer: fallbackText, sources: sources, top1_score: ret.top1, fallback: ret.fallback, degraded: true });
  }

  answer = promptLib.scrub(answer).slice(0, MAX_ANSWER_CHARS);
  logLine({ ts: started, origin: origin, ip_hash: iph, q: question, a: answer, channel: 'tencent', top_ids: ret.hits.map(function (h) { return h.id; }), top1_score: ret.top1, fallback: ret.fallback, latency_ms: Date.now() - started, model_called: true, model: AI_MODEL, suspect: suspect });
  return reply(200, origin, { ok: true, answer: answer, sources: sources, top1_score: ret.top1, fallback: ret.fallback });
};

// 供本地自测与脚本直接调用（不影响云函数入口）
exports._internal = {
  splitRequirements: splitRequirements,
  retrieveForJD: retrieveForJD,
  retrieve: retrieve,
  parseJDAnswer: parseJDAnswer,
  groundRatio: groundRatio,
  titleBoost: titleBoost,
  keywordScore: keywordScore,
  clientIp: clientIp,
  jdTag: jdTag,
  loadKB: loadKB
};

// 作为容器入口直接 `node index.js` 运行时，起 HTTP 服务（CloudBase HTTP 云函数模式）
if (require.main === module) {
  require('./server.js');
}