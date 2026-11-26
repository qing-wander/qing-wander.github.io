/**
 * 主页数据层（M3）—— 真相源 data/site-data.json 构建期 import + zod 宽契约。
 * 旧版经 window.SITE_DATA 快照在运行时渲染；React/Astro 版构建期直出（SEO 与
 * 无 JS 基线首次可见），运行时旧 main.js 仍会以同一快照重渲染同一 DOM（渐进桥接，
 * 字段口径与 main.js renderSite() 的 `|| ''` 容错语义一致——契约保持宽松 passthrough）。
 */
import { z } from 'zod';

const NumLike = z.union([z.string(), z.number()]).optional();

const HeroSchema = z.object({
  corners: z.array(z.string()).optional(),
  tags: z.array(z.object({ text: z.string().optional(), cls: z.string().optional() })).optional(),
  nameCn: z.string().optional(),
  nameEn: z.string().optional(),
  role: z.string().optional(),
  roleEn: z.string().optional(),
  bio: z.string().optional(),
  ctaProjects: z.string().optional(),
  ctaJd: z.string().optional(),
  ctaResume: z.string().optional(),
  resumeFile: z.string().optional(),
  statusMeta: z.string().optional(),
  idcard: z.object({
    photo: z.string().optional(),
    titleCn: z.string().optional(),
    titleEn: z.string().optional(),
    no: z.string().optional(),
    status: z.string().optional(),
    fields: z.array(z.object({
      dt: z.string().optional(),
      dd: z.string().optional(),
      cls: z.string().optional(),
    })).optional(),
    footCode: z.string().optional(),
  }).optional(),
}).passthrough();

const AboutSchema = z.object({
  photo: z.string().optional(),
  photoAlt: z.string().optional(),
  photoNo: z.string().optional(),
  /* stamp / lead / paragraphs 允许内联 HTML（renderSite innerHTML 语义） */
  stamp: z.string().optional(),
  lead: z.string().optional(),
  paragraphs: z.array(z.string()).optional(),
  stats: z.array(z.object({
    count: NumLike,
    suffix: z.string().optional(),
    label: z.string().optional(),
  })).optional(),
}).passthrough();

const ExperienceSchema = z.object({
  company: z.string().optional(),
  companyNote: z.string().optional(),
  role: z.string().optional(),
  time: z.string().optional(),
  profileId: z.string().optional(),
  points: z.array(z.string()).optional(),
  tags: z.array(z.object({ text: z.string().optional(), cls: z.string().optional() })).optional(),
}).passthrough();

const ProjectSchema = z.object({
  img: z.string().optional(),
  imgAlt: z.string().optional(),
  no: z.string().optional(),
  company: z.string().optional(),
  url: z.string().optional(),
  note: z.string().optional(),
  badge: z.string().optional(),
  badgeCls: z.string().optional(),
  year: z.string().optional(),
  yearDetail: z.string().optional(),
  title: z.string().optional(),
  titleEn: z.string().optional(),
  desc: z.string().optional(),
  modalTitle: z.string().optional(),
  modalDesc: z.string().optional(),
  stack: z.string().optional(),
  stackTags: z.array(z.string()).optional(),
  points: z.array(z.string()).optional(),
  stats: z.array(z.object({ v: NumLike, s: z.string().optional() })).optional(),
  video: z.object({
    src: z.string().optional(),
    poster: z.string().optional(),
    duration: z.string().optional(),
  }).optional(),
}).passthrough();

const WorkSchema = z.object({
  no: z.string().optional(),
  title: z.string().optional(),
  titleEn: z.string().optional(),
  desc: z.string().optional(),
  tech: z.array(z.string()).optional(),
  detailId: z.string().optional(),
  github: z.string().optional(),
  live: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

const SkillsSchema = z.object({
  rows: z.array(z.object({
    domain: z.string().optional(),
    name: z.string().optional(),
    ref: z.string().optional(),
    refUrl: z.string().optional(),
    stack: z.string().optional(),
    proof: z.string().optional(),
  })).optional(),
  bars: z.array(z.object({
    label: z.string().optional(),
    pct: NumLike,
  })).optional(),
  toolboxTitle: z.string().optional(),
  toolboxGroups: z.array(z.object({
    label: z.string().optional(),
    tags: z.array(z.object({ text: z.string().optional(), cls: z.string().optional() })).optional(),
  })).optional(),
  toolbox: z.array(z.object({ text: z.string().optional(), cls: z.string().optional() })).optional(),
  note: z.string().optional(),
}).passthrough();

const EducationSchema = z.object({
  main: z.object({
    time: z.string().optional(),
    tag: z.string().optional(),
    tagCls: z.string().optional(),
    logo: z.string().optional(),
    school: z.string().optional(),
    profileId: z.string().optional(),
    major: z.string().optional(),
    majorEn: z.string().optional(),
    stats: z.array(z.object({
      num: NumLike,
      unit: z.string().optional(),
      label: z.string().optional(),
      cls: z.string().optional(),
    })).optional(),
    notes: z.array(z.string()).optional(),
  }).optional(),
  sides: z.array(z.object({
    no: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
  })).optional(),
}).passthrough();

const AwardsSchema = z.object({
  certs: z.array(z.object({
    img: z.string().optional(),
    alt: z.string().optional(),
    stamp: z.string().optional(),
    stampCls: z.string().optional(),
    title: z.string().optional(),
    sub: z.string().optional(),
  })).optional(),
  list: z.array(z.object({
    year: z.string().optional(),
    name: z.string().optional(),
    sub: z.string().optional(),
  })).optional(),
}).passthrough();

const ContactSchema = z.object({
  big: z.string().optional(),
  cards: z.array(z.object({
    label: z.string().optional(),
    value: z.string().optional(),
    mini: z.string().optional(),
    href: z.string().optional(),
    plain: z.boolean().optional(),
    span: z.boolean().optional(),
  })).optional(),
  cta: z.object({
    title: z.string().optional(),
    desc: z.string().optional(),
    resumeFile: z.string().optional(),
    btnDownload: z.string().optional(),
    btnPreview: z.string().optional(),
  }).optional(),
}).passthrough();

const SiteSchema = z.object({
  meta: z.object({
    pageTitle: z.string().optional(),
    description: z.string().optional(),
    brandMark: z.string().optional(),
    brandSub: z.string().optional(),
    statusPill: z.string().optional(),
    siteUrl: z.string().optional(),
    footer: z.object({
      tagline: z.string().optional(),
      copyright: z.string().optional(),
      coord: z.string().optional(),
    }).optional(),
  }).passthrough(),
  hero: HeroSchema,
  marquee: z.string().optional(),
  about: AboutSchema,
  objective: z.object({
    cards: z.array(z.object({
      tag: z.string().optional(),
      role: z.string().optional(),
      roleSub: z.string().optional(),
      roleSm: z.string().optional(),
      desc: z.string().optional(),
      cls: z.string().optional(),
    })).optional(),
  }).optional(),
  education: EducationSchema,
  experience: z.array(ExperienceSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  works: z.array(WorkSchema).optional(),
  skills: SkillsSchema,
  awards: AwardsSchema,
  contact: ContactSchema,
  wall: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).passthrough();

import raw from '@data/site-data.json';

const parsed = SiteSchema.safeParse(raw);
if (!parsed.success) {
  throw new Error('[site-data] 主页数据契约校验失败：' + JSON.stringify(parsed.error.issues.slice(0, 5)));
}

export type SiteData = z.infer<typeof SiteSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export const SITE = parsed.data;
