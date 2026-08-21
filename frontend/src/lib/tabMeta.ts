// tabMeta.ts - 路由 → tab 元信息 (title + icon name) (P3.8.6 holy 反馈 #10544: tab 样式 + icon 多样)
//
// 每个 tab 类型有不同 icon, 跟 lucide-react 名字匹配.
// 渲染时 TabBar 用 dynamicIcon() 把 string → component.
//
// 优先级: 静态 map → 动态 pattern → fallback

import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FileCode, Palette, Rocket, Cpu, Users, Shield, Key,
  Trash2, Settings, Search, Home, BookOpen,
  FileText, FolderTree, Box, Image as ImageIcon, Boxes, Building2,
  Edit3, Globe, Database, History, ScrollText, BarChart3, Cog, Bell,
} from 'lucide-react';

export interface TabMeta {
  title: string;
  icon: string;  // lucide-react component name
}

/** 静态路由 → 默认 tab meta */
const STATIC_META: Record<string, TabMeta> = {
  '/dashboard': { title: '工作台', icon: 'LayoutDashboard' },
  '/layouts': { title: '模板管理', icon: 'FileCode' },
  '/themes': { title: '主题', icon: 'Palette' },
  '/publish': { title: '发布', icon: 'Rocket' },
  '/notifications': { title: '我的消息', icon: 'Bell' },
  '/ai/providers': { title: 'AI 提供方', icon: 'Cpu' },
  '/ai/runs': { title: 'AI 运行历史', icon: 'History' },
  '/users': { title: '用户管理', icon: 'Users' },
  '/roles': { title: '角色', icon: 'Shield' },
  '/permissions': { title: '权限', icon: 'Key' },
  '/recycle-bin': { title: '回收站', icon: 'Trash2' },
  '/settings': { title: '设置', icon: 'Settings' },
  '/search': { title: '搜索', icon: 'Search' },
  // P7: /sites tab 项已删除 (所有站点管理功能移到 Dashboard AllSitesSection)
  '/media': { title: '媒体库', icon: 'ImageIcon' },
  '/menus': { title: '导航菜单', icon: 'BookOpen' },
};

/** 动态路由前缀 → meta */
const DYNAMIC_PATTERNS: Array<{ pattern: RegExp; fallback: TabMeta }> = [
  { pattern: /^\/layouts\/[^/]+$/, fallback: { title: '模板编辑', icon: 'FileCode' } },
  { pattern: /^\/sites\/[^/]+\/media$/, fallback: { title: '媒体库', icon: 'ImageIcon' } },
  { pattern: /^\/sites\/[^/]+\/assets$/, fallback: { title: '站点资源', icon: 'Boxes' } },
  { pattern: /^\/sites\/[^/]+\/recycle$/, fallback: { title: '回收站', icon: 'Trash2' } },
  { pattern: /^\/sites\/[^/]+\/contents\/[^/]+$/, fallback: { title: '文章', icon: 'Edit3' } },
  { pattern: /^\/sites\/[^/]+\/contents\/new$/, fallback: { title: '新建文章', icon: 'Edit3' } },
  { pattern: /^\/sites\/[^/]+\/categories\/[^/]+$/, fallback: { title: '栏目', icon: 'FolderTree' } },
  { pattern: /^\/sites\/[^/]+\/layouts\/?$/, fallback: { title: '站点模板', icon: 'FileCode' } },
  // P3.9.1+ fix (holy 反馈 #11163/11182): 之前漏了这个 pattern, 走 fallback 把 layout uuid 当 tab title, 毫无意义
  { pattern: /^\/sites\/[^/]+\/layouts\/[^/]+$/, fallback: { title: '模板编辑', icon: 'FileCode' } },
  { pattern: /^\/sites\/[^/]+\/members$/, fallback: { title: '成员', icon: 'Users' } },
  { pattern: /^\/sites\/[^/]+$/, fallback: { title: '站点工作区', icon: 'Building2' } },
  { pattern: /^\/c\/[^/]+$/, fallback: { title: '栏目', icon: 'FolderTree' } },
];

/** 拿当前 pathname 的 tab meta */
export function getTabMeta(pathname: string): TabMeta {
  if (STATIC_META[pathname]) return STATIC_META[pathname];
  for (const { pattern, fallback } of DYNAMIC_PATTERNS) {
    if (pattern.test(pathname)) return fallback;
  }
  const last = pathname.split('/').filter(Boolean).pop() || 'home';
  return { title: last, icon: 'Home' };
}

/** lucide name → component (渲染用) */
export const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, FileCode, Palette, Rocket, Cpu, Users, Shield, Key,
  Trash2, Settings, Search, Home, BookOpen,
  FileText, FolderTree, Box, ImageIcon, Boxes, Building2,
  Edit3, Globe, Database, History, ScrollText, BarChart3, Cog, Bell,
};

/** 拿 lucide component (拿不到 fallback Home) */
export function dynamicIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Home;
}
