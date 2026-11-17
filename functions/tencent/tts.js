'use strict';

/**
 * 腾讯云语音合成（TextToVoice）· 零第三方依赖直调模块
 *
 * 设计依据：docs/ai-voice-survey.md 第 7 节（Phase 2 云端通道）
 *
 * - 用 Node 内置 https / crypto 手写 TC3-HMAC-SHA256 签名，沿用项目「dependencies: {}」约定；
 * - SecretId/Key 只从环境变量读，绝不进代码包、绝不回给前端；
 *   优先 TTS_SECRET_ID/TTS_SECRET_KEY，缺失时退到 SCF 运行角色临时密钥
 *   （TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN），后者无需人工创建永久密钥；
 * - 按 text+voice+speed 做实例内 LRU 缓存，避免同一句话重复消耗字符额度；
 * - 只使用基础/精品音色（默认 101001 智瑜·情感女声），落在 800 万字符免费包内。
 *
 * 环境变量：
 *   TTS_SECRET_ID / TTS_SECRET_KEY   可选，主账号或子账号 API 密钥
 *   TTS_TOKEN                       可选，临时密钥的 session token
 *   TTS_VOICE_TYPE                  可选，默认 101001
 *   TTS_REGION                      可选，默认 ap-shanghai
 */

var https = require('https');
var crypto = require('crypto');

var HOST = 'tts.tencentcloudapi.com';
var SERVICE = 'tts';
var ACTION = 'TextToVoice';
var VERSION = '2019-08-23';
var REGION = process.env.TTS_REGION || 'ap-shanghai';
var VOICE_TYPE = Number(process.env.TTS_VOICE_TYPE || 101001);
var CODEC = 'mp3';
var SAMPLE_RATE = 16000;
var MAX_TEXT_CHARS = 150;          // 官方：中文最多 150 汉字
var REQUEST_TIMEOUT_MS = 8000;
var CACHE_MAX = 120;                // 实例内最多缓存 120 段音频

// 语气分层（Web Speech API 的 rate/pitch 概念映射到腾讯云 Speed）
var SPEED = { greet: -0.2, answer: 0, error: -0.15 };

var cache = Object.create(null);
var cacheOrder = [];

function sha256hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hmac(key, s) {
  return crypto.createHmac('sha256', key).update(s, 'utf8').digest();
}

/** 三种密钥来源都没有时返回 null：调用方据此给出「未配置」而不是 500 */
function credentials() {
  /* 两套密钥必须「成套」使用：SCF 运行角色会注入 TENCENTCLOUD_SESSIONTOKEN，
     若把它和子账号永久密钥混用，腾讯云会返回 AuthFailure.TokenFailure。 */
  var id = process.env.TTS_SECRET_ID || '';
  var key = process.env.TTS_SECRET_KEY || '';
  if (id && key) return { id: id, key: key, token: process.env.TTS_TOKEN || '' };

  id = process.env.TENCENTCLOUD_SECRETID || '';
  key = process.env.TENCENTCLOUD_SECRETKEY || '';
  if (id && key) {
    return { id: id, key: key, token: process.env.TENCENTCLOUD_SESSIONTOKEN || '' };
  }
  return null;
}

/** TC3-HMAC-SHA256：CanonicalRequest → StringToSign → 派生签名密钥 → Authorization */
function authorization(c, payload, timestamp) {
  var date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  var contentType = 'application/json; charset=utf-8';
  var canonicalHeaders = 'content-type:' + contentType + '\nhost:' + HOST + '\n';
  var signedHeaders = 'content-type;host';
  var canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)
  ].join('\n');
  var scope = date + '/' + SERVICE + '/tc3_request';
  var stringToSign = [
    'TC3-HMAC-SHA256', String(timestamp), scope, sha256hex(canonicalRequest)
  ].join('\n');
  var kDate = hmac('TC3' + c.key, date);
  var kService = hmac(kDate, SERVICE);
  var kSigning = hmac(kService, 'tc3_request');
  var signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return 'TC3-HMAC-SHA256' +
    ' Credential=' + c.id + '/' + scope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature;
}

function postTTS(c, payloadObj) {
  return new Promise(function (resolve, reject) {
    var payload = JSON.stringify(payloadObj);
    var ts = Math.floor(Date.now() / 1000);
    var headers = {
      'Authorization': authorization(c, payload, ts),
      'Content-Type': 'application/json; charset=utf-8',
      'Host': HOST,
      'X-TC-Action': ACTION,
      'X-TC-Timestamp': String(ts),
      'X-TC-Version': VERSION,
      'X-TC-Region': REGION,
      'Content-Length': Buffer.byteLength(payload, 'utf8')
    };
    if (c.token) headers['X-TC-Token'] = c.token;

    var req = https.request(
      { hostname: HOST, port: 443, path: '/', method: 'POST', headers: headers, timeout: REQUEST_TIMEOUT_MS },
      function (res) {
        var chunks = [];
        res.on('data', function (c2) { chunks.push(c2); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(text); } catch (e) { /* 保留原文 */ }
          if (!json || !json.Response) {
            reject(new Error('tts_bad_response: HTTP ' + res.statusCode));
            return;
          }
          var r = json.Response;
          if (r.Error) {
            var err = new Error('tts_api: ' + r.Error.Code + ' ' + (r.Error.Message || ''));
            err.code = r.Error.Code;
            err.requestId = r.RequestId || '';
            reject(err);
            return;
          }
          if (!r.Audio) { reject(new Error('tts_empty_audio')); return; }
          resolve({ audio: r.Audio, requestId: r.RequestId || '' });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('tts_timeout')); });
    req.on('error', reject);
    req.write(payload, 'utf8');
    req.end();
  });
}

function cachePut(key, value) {
  if (cache[key] === undefined) cacheOrder.push(key);
  cache[key] = value;
  while (cacheOrder.length > CACHE_MAX) {
    var old = cacheOrder.shift();
    if (old !== undefined) delete cache[old];
  }
}

/**
 * 合成一段文本
 * @param {string} text  ≤150 中文字符（前端已按 ≤110 分句）
 * @param {object} opts  { kind: 'greet'|'answer'|'error', voice: number }
 * @returns {Promise<{audio, mime, cached, chars, voice, speed}>}
 */
function synth(text, opts) {
  opts = opts || {};
  var clean = String(text || '').trim();
  if (!clean) return Promise.reject(new Error('tts_empty_text'));
  if (clean.length > MAX_TEXT_CHARS) {
    return Promise.reject(new Error('tts_text_too_long: ' + clean.length + '>' + MAX_TEXT_CHARS));
  }

  var c = credentials();
  if (!c) {
    var e = new Error('tts_not_configured');
    e.code = 'tts_not_configured';
    return Promise.reject(e);
  }

  var voice = Number(opts.voice) || VOICE_TYPE;
  var speed = SPEED[opts.kind] == null ? (SPEED.answer) : SPEED[opts.kind];
  var key = sha256hex(clean + '|' + voice + '|' + speed);
  if (cache[key] !== undefined) {
    return Promise.resolve({
      audio: cache[key], mime: 'audio/mpeg', cached: true,
      chars: clean.length, voice: voice, speed: speed
    });
  }

  var sessionId = crypto.randomBytes(16).toString('hex');
  return postTTS(c, {
    Text: clean,
    SessionId: sessionId,
    VoiceType: voice,
    Speed: speed,
    Volume: 0,
    ModelType: 1,
    PrimaryLanguage: 1,
    SampleRate: SAMPLE_RATE,
    Codec: CODEC
  }).then(function (r) {
    cachePut(key, r.audio);
    return {
      audio: r.audio, mime: 'audio/mpeg', cached: false,
      chars: clean.length, voice: voice, speed: speed, requestId: r.requestId
    };
  });
}

module.exports = {
  available: function () { return !!credentials(); },
  synth: synth,
  config: function () { return { voice: VOICE_TYPE, codec: CODEC, region: REGION }; },
  maxChars: MAX_TEXT_CHARS,
  _internal: { authorization: authorization, sha256hex: sha256hex }
};
