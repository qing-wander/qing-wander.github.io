/**
 * 学校档案数据层（M2）—— 真相源 data/school-profiles.json 构建期 import + zod 契约校验。
 * 学历验证码的「展示期脱敏」沿旧规：所有学校的验证码统一在渲染出口替换为圆点，
 * 只有核验解锁后才渲染原文（见 VerifyFlow / SchoolPanel 的 redact 联动）。
 */
import { z } from 'zod';

export const REDACTED = '••••••••••••••••';

const SchoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  nameEn: z.string().optional(),
  code: z.string().optional(),
  logo: z.string().optional(),
  logoNote: z.string().optional(),
  industry: z.string().optional(),
  period: z.string().optional(),
  degree: z.string().optional(),
  major: z.string().optional(),
  majorEn: z.string().optional(),
  majorNote: z.string().optional(),
  currentName: z.string().optional(),
  nameNote: z.string().optional(),
  oneLine: z.string().optional(),
  pills: z.array(z.string()).optional(),
  quickStats: z.array(z.string()).optional(),
  kpis: z.array(z.object({
    label: z.string().optional(),
    value: z.string().optional(),
    sub: z.string().optional(),
  })).optional(),
  school: z.object({
    intro: z.string().optional(),
    motto: z.string().optional(),
    website: z.object({ href: z.string(), text: z.string() }).optional(),
    facts: z.array(z.object({
      label: z.string().optional(),
      text: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })).optional(),
    history: z.array(z.object({
      date: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })).optional(),
    campuses: z.array(z.object({
      name: z.string().optional(),
      address: z.string().optional(),
      note: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })).optional(),
    highlights: z.array(z.object({
      title: z.string().optional(),
      detail: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })).optional(),
  }).optional(),
  timeline: z.object({
    note: z.string().optional(),
    items: z.array(z.object({
      no: z.string().optional(),
      term: z.string().optional(),
      kind: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })).optional(),
  }).optional(),
  courses: z.object({
    note: z.string().optional(),
    terms: z.array(z.object({
      term: z.string().optional(),
      en: z.string().optional(),
      focus: z.string().optional(),
      output: z.string().optional(),
      items: z.array(z.object({
        name: z.string().optional(),
        confirmed: z.boolean().optional(),
      })).optional(),
    })).optional(),
  }).optional(),
  awards: z.array(z.object({
    img: z.string().optional(),
    alt: z.string().optional(),
    tag: z.string().optional(),
    level: z.string().optional(),
    title: z.string().optional(),
    org: z.string().optional(),
    year: z.string().optional(),
    note: z.string().optional(),
    muted: z.boolean().optional(),
  })).optional(),
  album: z.array(z.object({
    img: z.string().optional(),
    alt: z.string().optional(),
    tag: z.string().optional(),
    caption: z.string().optional(),
    note: z.string().optional(),
    empty: z.boolean().optional(),
  })).optional(),
  growth: z.object({
    note: z.string().optional(),
    items: z.array(z.object({
      course: z.string().optional(),
      now: z.string().optional(),
      text: z.string().optional(),
    })).optional(),
  }).optional(),
  verify: z.object({
    label: z.string().optional(),
    code: z.string().optional(),
    tip: z.string().optional(),
    url: z.string().optional(),
    qrImage: z.string().optional(),
    qrAlt: z.string().optional(),
  }).optional(),
  dataConfidence: z.object({
    note: z.string().optional(),
    items: z.array(z.object({
      label: z.string().optional(),
      level: z.string().optional(),
      detail: z.string().optional(),
    })).optional(),
  }).optional(),
  sources: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    title: z.string().optional(),
    url: z.string().optional(),
    note: z.string().optional(),
  })).optional(),
});

const RootSchema = z.object({
  meta: z.object({
    backToResume: z.string().optional(),
    backToPortfolio: z.string().optional(),
    disclaimer: z.string().optional(),
    collectedAt: z.string().optional(),
  }).passthrough(),
  schools: z.record(z.string(), SchoolSchema),
});

import raw from '@data/school-profiles.json';

const parsed = RootSchema.safeParse(raw);
if (!parsed.success) {
  throw new Error('[school-profiles] 数据契约校验失败：' + JSON.stringify(parsed.error.issues.slice(0, 5)));
}

export type School = z.infer<typeof SchoolSchema>;

export const SCHOOL_META = parsed.data.meta;
export const SCHOOLS: Record<string, School> = parsed.data.schools;

/** 全部学校的验证码（渲染出口统一脱敏口径，与旧版一致） */
export const VERIFY_CODES: string[] = Object.keys(SCHOOLS)
  .map((k) => SCHOOLS[k]?.verify?.code || '')
  .filter(Boolean);

export function getSchool(id: string): School | null {
  return SCHOOLS[id] || null;
}

export function listSchools(): School[] {
  return Object.keys(SCHOOLS).map((k) => SCHOOLS[k]!);
}

/** 深拷贝 + 验证码脱敏（锁定态渲染用；解锁态直接深拷贝原文） */
export function redactCopy(root: unknown, unlocked: boolean): unknown {
  const clone = JSON.parse(JSON.stringify(root));
  if (unlocked) return clone;
  const walk = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'string') obj[i] = redactString(obj[i] as string);
        else walk(obj[i]);
      }
    } else {
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        const v = (obj as Record<string, unknown>)[k];
        if (typeof v === 'string') (obj as Record<string, unknown>)[k] = redactString(v);
        else walk(v);
      }
    }
  };
  walk(clone);
  return clone;
}

function redactString(s: string): string {
  let out = s;
  for (const code of VERIFY_CODES) out = out.split(code).join(REDACTED);
  return out;
}
