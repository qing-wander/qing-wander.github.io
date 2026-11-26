/**
 * 公司档案数据层（M2）—— 真相源 data/company-profiles.json 构建期 import + zod 契约校验。
 * 旧版经 window.COMPANY_PROFILES（JS 快照）读取；React 版直接 import JSON（N6 数据链不变，
 * sync_company_profiles.py --check 漂移闸门继续把守 JSON↔快照一致性）。
 * 字段全部可选：与旧版渲染一致，缺失板块静默跳过、未公开如实标注。
 */
import { z } from 'zod';

const KpiSchema = z.object({
  value: z.string(),
  label: z.string(),
  sub: z.string().optional(),
  source: z.union([z.string(), z.number()]).optional(),
});

const ExecSchema = z.object({
  name: z.string().optional(),
  photo: z.string().optional(),
  title: z.string().optional(),
  bio: z.string().optional(),
});

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  code: z.string().optional(),
  industry: z.string().optional(),
  oneLine: z.string().optional(),
  stage: z.string().optional(),
  scale: z.string().optional(),
  entity: z.string().optional(),
  renameNote: z.string().optional(),
  logo: z.string().optional(),
  logoNote: z.string().optional(),
  logoSource: z.union([z.string(), z.number()]).optional(),
  website: z.nullable(z.object({ href: z.string(), text: z.string() })).optional(),
  registry: z.nullable(z.object({
    hq: z.string().optional(),
    founded: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
  })).optional(),
  quickStats: z.array(z.string()).optional(),
  kpis: z.array(KpiSchema).optional(),
  predecessor: z.nullable(z.object({
    name: z.string().optional(),
    shortName: z.string().optional(),
    founded: z.string().optional(),
    formerName: z.string().optional(),
    legalRep: z.string().optional(),
    capital: z.string().optional(),
    scale: z.string().optional(),
    business: z.string().optional(),
    link: z.string().optional(),
    sources: z.array(z.union([z.string(), z.number()])).optional(),
  })).optional(),
  business: z.nullable(z.object({
    main: z.string().optional(),
    model: z.string().optional(),
    position: z.string().optional(),
    bossIntro: z.string().optional(),
  })).optional(),
  showcase: z.array(z.object({
    name: z.string().optional(),
    img: z.string().optional(),
    domain: z.string().optional(),
    mark: z.string().optional(),
    tone: z.string().optional(),
    kind: z.string().optional(),
    tagline: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
    sourceLabel: z.string().optional(),
    url: z.string().optional(),
    mine: z.boolean().optional(),
    subProducts: z.array(z.string()).optional(),
  })).optional(),
  interviews: z.array(z.object({
    title: z.string().optional(),
    video: z.string().optional(),
    poster: z.string().optional(),
    host: z.string().optional(),
    guest: z.string().optional(),
    date: z.string().optional(),
    duration: z.string().optional(),
    platform: z.string().optional(),
    desc: z.string().optional(),
    chapters: z.array(z.string()).optional(),
    originalUrl: z.string().optional(),
    archiveNote: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
  })).optional(),
  chart: z.nullable(z.object({
    title: z.string().optional(),
    latest: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
    metrics: z.array(z.object({
      id: z.string(),
      label: z.string().optional(),
      points: z.array(z.object({
        label: z.string(),
        value: z.union([z.number(), z.string()]),
        note: z.string().optional(),
      })),
    })),
  })).optional(),
  funding: z.nullable(z.object({
    note: z.string().optional(),
    rounds: z.array(z.object({
      round: z.string(),
      amount: z.string().optional(),
      investors: z.string().optional(),
      date: z.string(),
      source: z.union([z.string(), z.number()]).optional(),
    })),
  })).optional(),
  investors: z.nullable(z.object({
    note: z.string().optional(),
    list: z.array(z.object({
      name: z.string(),
      entity: z.string().optional(),
      stake: z.string().optional(),
      rounds: z.string().optional(),
      verify: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })),
    others: z.string().optional(),
  })).optional(),
  entityHistory: z.nullable(z.object({
    note: z.string().optional(),
    rows: z.array(z.object({
      period: z.string().optional(),
      entity: z.string().optional(),
      event: z.string().optional(),
      investors: z.string().optional(),
      basis: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })),
  })).optional(),
  recognition: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    source: z.union([z.string(), z.number()]).optional(),
  })).optional(),
  bossProfile: z.nullable(z.object({
    source: z.union([z.string(), z.number()]).optional(),
    platformTitle: z.string().optional(),
    industryTag: z.string().optional(),
    scaleTag: z.string().optional(),
    financingTag: z.string().optional(),
    workTime: z.string().optional(),
    rename: z.string().optional(),
    intro: z.string().optional(),
    registryNote: z.string().optional(),
    financingNote: z.string().optional(),
    culture: z.array(z.string()).optional(),
    welfare: z.array(z.string()).optional(),
    welfareLabel: z.string().optional(),
    talentDevelopment: z.array(z.string()).optional(),
    products: z.array(z.string()).optional(),
    productDetails: z.array(z.string()).optional(),
    milestones: z.array(z.string()).optional(),
    awards: z.array(z.string()).optional(),
    foundingTeam: z.array(ExecSchema).optional(),
    offices: z.array(z.string()).optional(),
  })).optional(),
  competitors: z.nullable(z.object({
    landscape: z.string().optional(),
    players: z.array(z.object({
      name: z.string().optional(),
      profileId: z.string().optional(),
      kind: z.string().optional(),
      vendor: z.string().optional(),
      tone: z.string().optional(),
      mark: z.string().optional(),
      position: z.string().optional(),
      scale: z.string().optional(),
      vs: z.string().optional(),
      url: z.string().optional(),
      source: z.union([z.string(), z.number()]).optional(),
    })).optional().default([]),
  })).optional(),
  outlook: z.nullable(z.object({
    opportunities: z.array(z.string()).optional(),
    risks: z.array(z.string()).optional(),
  })).optional(),
  office: z.array(z.object({
    img: z.string().optional(),
    alt: z.string().optional(),
    note: z.string().optional(),
  })).optional(),
  panoramas: z.array(z.object({
    img: z.string(),
    cover: z.string().optional(),
    title: z.string().optional(),
    alt: z.string().optional(),
    note: z.string().optional(),
    address: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
    yaw: z.number().optional(),
    pitch: z.number().optional(),
    fov: z.number().optional(),
  })).optional(),
  dataConfidence: z.nullable(z.object({
    level: z.string().optional(),
    summary: z.string().optional(),
    verified: z.array(z.string()).optional(),
    unverified: z.array(z.string()).optional(),
    conflicts: z.array(z.string()).optional(),
  })).optional(),
  secureMaterials: z.nullable(z.object({
    resource: z.string(),
    title: z.string().optional(),
    note: z.string().optional(),
    items: z.array(z.object({
      label: z.string().optional(),
      issuer: z.string().optional(),
      status: z.string().optional(),
    })).optional(),
  })).optional(),
  sources: z.array(z.object({
    n: z.union([z.string(), z.number()]),
    name: z.string(),
    url: z.string().optional(),
  })).optional().default([]),
  wechat: z.array(z.object({
    name: z.string(),
    account: z.string().optional(),
    note: z.string().optional(),
    url: z.string().optional(),
    source: z.union([z.string(), z.number()]).optional(),
  })).optional(),
});

const RootSchema = z.object({
  meta: z.object({
    collectedAt: z.string().optional(),
    disclaimer: z.string().optional(),
  }).passthrough(),
  companies: z.record(z.string(), CompanySchema),
});

import raw from '@data/company-profiles.json';

const parsed = RootSchema.safeParse(raw);
if (!parsed.success) {
  /* 构建期即暴露数据结构漂移（旧版 JS 快照静默容错，React 版提前到 build 期） */
  throw new Error('[company-profiles] 数据契约校验失败：' + JSON.stringify(parsed.error.issues.slice(0, 5)));
}

export type Company = z.infer<typeof CompanySchema>;
export type Exec = z.infer<typeof ExecSchema>;
export type ChartMetric = NonNullable<Company['chart']>['metrics'][number];

export const COMPANY_META = parsed.data.meta;
export const COMPANIES: Record<string, Company> = parsed.data.companies;

export function getCompany(id: string): Company | null {
  return COMPANIES[id] || null;
}

export function listCompanies(): Company[] {
  return Object.keys(COMPANIES).map((k) => COMPANIES[k]!);
}
