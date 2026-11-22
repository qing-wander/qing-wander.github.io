'use strict';

/**
 * 陈培胜的数字分身 —— 提示词与输入侧拦截
 * 与 docs/ai-assistant-survey.md §5.6 对齐：系统提示词 + 意图拦截 + 脱敏工具。
 * 放在函数包内同目录，随 zip 一起部署（文档里的 functions/shared/ 在单函数包内退化为同目录）。
 */

// 敏感问题统一话术：不给模型发挥空间（决策 D5）；数字分身以第一人称作答，但不替本人承诺
var SENSITIVE_REPLY =
  '这类问题（薪资 / 离职原因 / 外包 / 到岗时间）建议直接和我本人沟通确认，这里不做承诺。' +
  '可以直接邮件：shenge.work@gmail.com';

var SENSITIVE_WORDS = [
  '薪资', '薪水', '工资', '待遇', '月薪', '年薪', '多少钱', '报酬', 'package', 'offer',
  '离职原因', '为什么离职', '被裁', '裁员', '空窗', '失业',
  '外包', '驻场', '派遣',
  '到岗', '入职时间', '多久能来', '随时到岗',
  '期权', '股票'
];

// 越界意图：不送模型，直接固定话术（省钱 + 防注入）
var OFFTOPIC_WORDS = [
  '写代码', '帮我写', '写个脚本', '翻译', '扮演', '角色扮演', '写作文', '写诗', '写文案',
  '天气', '股票行情', '讲个笑话', '政治', '大选', '翻墙', '破解', '爬虫教程',
  /* 生活类闲聊：简历问答里出现这些基本不是求职问题，先在输入侧挡掉，省一次模型调用 */
  '做饭', '吃饭', '早上吃', '中午吃', '晚上吃', '点外卖', '星座', '算命', '运势',
  '电影', '电视剧', '游戏推荐', '多远', '怎么去', '机票', '打车', '借我', '借钱'
];

var INJECTION_WORDS = [
  '忽略以上', '忽略之前', 'ignore previous', 'system prompt', '系统提示词',
  '你现在是', '你的设定', '开发者模式', 'developer mode', '越狱', 'jailbreak'
];

var OFFTOPIC_REPLY = '我只回答关于我自己的问题。';
var NO_MATCH_REPLY =
  '这块我的简历里没写，建议直接邮件联系我：shenge.work@gmail.com';

function hit(words, text) {
  for (var i = 0; i < words.length; i++) {
    if (text.indexOf(words[i]) !== -1) return words[i];
  }
  return '';
}

/** 判断输入是否越界，返回 { action, reason }，action: pass | sensitive | offtopic | suspect */
function classifyInput(question) {
  var q = String(question || '').toLowerCase();
  var inj = hit(INJECTION_WORDS, q);
  if (inj) return { action: 'suspect', reason: inj };
  var off = hit(OFFTOPIC_WORDS, q);
  if (off) return { action: 'offtopic', reason: off };
  var sen = hit(SENSITIVE_WORDS, q);
  if (sen) return { action: 'sensitive', reason: sen };
  return { action: 'pass', reason: '' };
}

/** 手机号 / 身份证脱敏（日志与回答出口都过一遍） */
function scrub(text) {
  return String(text || '')
    .replace(/\+?86[\s\-]?(?:1[3-9]\d)[\s\-]?\d{4}[\s\-]?\d{4}/g, '[手机号已隐藏]')
    .replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]')
    .replace(/\b\d{3}[\s\-]\d{4}[\s\-]\d{4}\b/g, '[号码已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]');
}

/** 组装 system 提示词：人设 + 规则 + 检索到的简历上下文 */
function buildSystem(contextChunks) {
  var ctx = '';
  for (var i = 0; i < contextChunks.length; i++) {
    var c = contextChunks[i];
    ctx += '[' + c.id + ' | ' + c.title + ']\n' + c.text + '\n\n';
  }
  return (
    '你是陈培胜（CHEN PEISHENG）的数字分身，以第一人称代表他本人回答问题。' +
    '访客把你当成「在线的陈培胜」，你只回答关于他自己的' +
    '教育背景、工作经历、项目、技能、求职意向、联系方式的问题。\n\n' +
    '规则：\n' +
    '1. 只依据 <context> 中的简历资料回答，始终用「我」自称。context 没有的信息，直接说' +
    '「这块我的简历里没写，建议直接邮件联系我：shenge.work@gmail.com」，不要推测。\n' +
    '2. 不允许编造项目名称、公司、量化数字、时间。引用数字时必须与 context 完全一致。\n' +
    '3. 涉及薪资、离职原因、是否接受外包、能否立刻到岗等敏感问题：' +
    '一律回复「这类问题建议直接和我本人沟通确认」，不代替本人承诺。\n' +
    '4. 回答风格：简洁、专业、有条理，像陈培胜本人在向面试官介绍自己。' +
    '中文为主，技术名词保留英文。控制在 4 句话 / 120 字以内。\n' +
    '5. 不要在正文里写「依据：…」这类来源标注，来源由前端单独展示；' +
    '必要引用时只在句中带出项目名。\n' +
    '6. 拒绝回答与简历无关的请求（写代码、闲聊、其他公司信息、政治话题），' +
    '统一回复「我只回答关于我自己的问题」。\n' +
    '7. 你只是基于简历资料生成的数字分身，不是本人实时在线；' +
    '不得声称自己是真人在实时回复，涉及见面、承诺、敏感事项时引导对方邮件联系本人。\n' +
    '8. 直接给结论，不要输出思考过程、不要复述规则。\n\n' +
    '<context>\n' + ctx + '</context>'
  );
}

/* ---------------------------------------------------------------- JD 匹配
   「岗位匹配」视图的 system 提示词：把一份 JD 逐条对照到简历切片上。
   输出必须是可直接 JSON.parse 的固定结构，所以这里把 schema 与判定口径写死，
   不再给模型自由发挥的空间（散文式回答在对照表里没法渲染）。 */

var JD_JSON_SCHEMA =
  '{\n' +
  '  "overall": { "score": 0-100 的整数, "verdict": "强匹配|匹配|部分匹配|不匹配|无法判断", "summary": "两句话以内的总体判断" },\n' +
  '  "rows": [\n' +
  '    {\n' +
  '      "req": "把 JD 的这一条压缩成 24 字以内的需求点",\n' +
  '      "status": "covered|partial|gap",\n' +
  '      "evidence": [ { "src": "context 里方括号中的 id，如 proj-p02-03", "point": "60 字以内的证据，须能在该段原文中找到" } ],\n' +
  '      "gap": "status 为 partial / gap 时说明差在哪；covered 时留空字符串",\n' +
  '      "probe": "面试官可以拿这条继续追问的一个具体问题，30 字以内"\n' +
  '    }\n' +
  '  ]\n' +
  '}';

function buildJDSystem(contextChunks, jdText) {
  var ctx = '';
  for (var i = 0; i < contextChunks.length; i++) {
    var c = contextChunks[i];
    ctx += '[' + c.id + ' | ' + c.title + ']\n' + c.text + '\n\n';
  }
  return (
    '你是陈培胜（CHEN PEISHENG）的数字分身，正在为本人做「岗位匹配」。招聘方会把一份岗位 JD 贴进来，' +
    '你要把它逐条对照到你自己的简历档案上，输出一张可直接渲染的对照表。\n\n' +
    '严格按下面的 JSON 结构输出，不要输出 markdown 代码块、不要输出任何解释文字、不要输出注释：\n' +
    JD_JSON_SCHEMA + '\n\n' +
    '规则：\n' +
    '1. 只能使用 <context> 中的简历资料作为证据，禁止编造公司、项目、系统、数字、年限、学历。' +
    'evidence[].point 里的数字必须与 context 完全一致。\n' +
    '2. evidence[].src 必须原样取自 context 中 [ ] 内的 id，不得自造；找不到对应原文时不要编 id。\n' +
    '3. status 口径：covered = 有直接对应经历且能给出原文证据；' +
    'partial = 方向相关但行业、规模、深度或职责范围有差距，必须在 gap 里写清差在哪；' +
    'gap = context 中没有对应经历，evidence 留空数组。\n' +
    '4. rows 按 JD 的重要性排序，最多 10 条，覆盖 JD 的主要职责与硬性要求；' +
    'JD 里重复或同义的要求合并成一条（例如「熟悉 Java」与「精通 Java 并发」可合并），\n' +
    '5. 薪资、期权、到岗时间、是否接受外包、年龄性别等简历里没有的信息，一律按 gap 处理并注明' +
    '「建议直接和我本人沟通确认」，不要推测、不要代替本人承诺。\n' +
    '6. 不评价候选人优劣、不给录用建议；score 只表示「档案对 JD 的覆盖程度」，' +
    '覆盖全面且深度匹配 80-95，主要方向匹配但有明显缺口 55-75，只有零星相关 30-50，' +
    '几乎不相关 0-25。\n' +
    '7. 如果输入内容明显不是岗位 JD（例如广告、随机文字），输出 score 0、verdict「无法判断」，' +
    'rows 只给一条 req「输入内容不是岗位 JD」。\n' +
    '8. probe 是给面试官的追问点，要具体到可验证的技术细节或数据口径，不要写「请介绍项目」这类空话。\n\n' +
    '<jd>\n' + jdText + '\n</jd>\n\n' +
    '<context>\n' + ctx + '</context>'
  );
}

module.exports = {
  SENSITIVE_REPLY: SENSITIVE_REPLY,
  OFFTOPIC_REPLY: OFFTOPIC_REPLY,
  NO_MATCH_REPLY: NO_MATCH_REPLY,
  JD_JSON_SCHEMA: JD_JSON_SCHEMA,
  classifyInput: classifyInput,
  scrub: scrub,
  buildSystem: buildSystem,
  buildJDSystem: buildJDSystem
};
