/**
 * 资源 URL 工具（M2）—— 与旧版「渲染用原样路径 + DOMContentLoaded 统一 rewriteDOM」
 * 的时序等价：React 组件初始渲染输出原样相对路径（SSG 直出与客户端首次渲染一致，
 * 避免水合 mismatch），挂载后由 Panel 的 useAssetCdnRewrite() 对容器统一重写（与旧版
 * asset-cdn.js 的 applyDOM 同一拍），此后 React 不再触碰这些 img 的 src（diff 不变即不动 DOM）。
 */

declare global {
  interface Window {
    AssetURL?: {
      of: (v: string) => string;
      rewriteDOM: (root?: ParentNode) => void;
    };
    CPPanorama?: {
      open: (list: Array<Record<string, unknown>>, index: number, poster?: string) => void;
      close: () => void;
      resolve: (p: string) => string;
      isOpen: () => boolean;
    };
    SecureAccess?: { mountAll: (root?: ParentNode) => void };
    CompanySocial?: {
      mount: (container: HTMLElement | null, cid: string) => void;
      mountAll: () => void;
      skeleton: (cid: string) => string;
    };
  }
}

export const assetUrl = (p: string): string => p;
