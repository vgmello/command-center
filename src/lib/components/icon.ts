import type { Component } from 'svelte';
import Activity from '@lucide/svelte/icons/activity';
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import ArrowUp from '@lucide/svelte/icons/arrow-up';
import Bell from '@lucide/svelte/icons/bell';
import Box from '@lucide/svelte/icons/box';
import Boxes from '@lucide/svelte/icons/boxes';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import ChevronDown from '@lucide/svelte/icons/chevron-down';
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import CircleAlert from '@lucide/svelte/icons/circle-alert';
import CircleCheck from '@lucide/svelte/icons/circle-check';
import CircleHelp from '@lucide/svelte/icons/circle-help';
import CircleX from '@lucide/svelte/icons/circle-x';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import Clock from '@lucide/svelte/icons/clock';
import Calendar from '@lucide/svelte/icons/calendar';
import Cloud from '@lucide/svelte/icons/cloud';
import Cpu from '@lucide/svelte/icons/cpu';
import Database from '@lucide/svelte/icons/database';
import Ellipsis from '@lucide/svelte/icons/ellipsis';
import Code from '@lucide/svelte/icons/code';
import ExternalLink from '@lucide/svelte/icons/external-link';
import FileChartColumn from '@lucide/svelte/icons/file-chart-column';
import FileText from '@lucide/svelte/icons/file-text';
import Funnel from '@lucide/svelte/icons/funnel';
import Gauge from '@lucide/svelte/icons/gauge';
import HardDrive from '@lucide/svelte/icons/hard-drive';
import Gift from '@lucide/svelte/icons/gift';
import GitBranch from '@lucide/svelte/icons/git-branch';
import Handshake from '@lucide/svelte/icons/handshake';
import Info from '@lucide/svelte/icons/info';
import Landmark from '@lucide/svelte/icons/landmark';
import Layers from '@lucide/svelte/icons/layers';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Library from '@lucide/svelte/icons/library';
import List from '@lucide/svelte/icons/list';
import MessageSquare from '@lucide/svelte/icons/message-square';
import MemoryStick from '@lucide/svelte/icons/memory-stick';
import Network from '@lucide/svelte/icons/network';
import Package from '@lucide/svelte/icons/package';
import Percent from '@lucide/svelte/icons/percent';
import Receipt from '@lucide/svelte/icons/receipt';
import RefreshCw from '@lucide/svelte/icons/refresh-cw';
import Repeat from '@lucide/svelte/icons/repeat';
import Rocket from '@lucide/svelte/icons/rocket';
import ScrollText from '@lucide/svelte/icons/scroll-text';
import Search from '@lucide/svelte/icons/search';
import Server from '@lucide/svelte/icons/server';
import Settings from '@lucide/svelte/icons/settings';
import Share2 from '@lucide/svelte/icons/share-2';
import Shield from '@lucide/svelte/icons/shield';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Star from '@lucide/svelte/icons/star';
import Tag from '@lucide/svelte/icons/tag';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import Truck from '@lucide/svelte/icons/truck';
import Undo2 from '@lucide/svelte/icons/undo-2';
import Users from '@lucide/svelte/icons/users';
import Warehouse from '@lucide/svelte/icons/warehouse';

/**
 * Icon key → component.
 *
 * The data layer names an icon with a string; only this module knows what that
 * string draws. That keeps `@lucide/svelte` out of anything server-side and
 * means a snapshot stays serialisable — a component reference is not.
 *
 * Named imports rather than the barrel: importing one icon per line is what
 * keeps the bundle to the icons actually used.
 */
const ICONS = {
	activity: Activity,
	'arrow-down': ArrowDown,
	'arrow-right': ArrowRight,
	'arrow-up': ArrowUp,
	bell: Bell,
	box: Box,
	boxes: Boxes,
	'chart-column': ChartColumn,
	'chevron-down': ChevronDown,
	'chevron-left': ChevronLeft,
	'chevron-right': ChevronRight,
	'circle-alert': CircleAlert,
	'circle-check': CircleCheck,
	'circle-help': CircleHelp,
	'circle-x': CircleX,
	'clipboard-check': ClipboardCheck,
	calendar: Calendar,
	clock: Clock,
	code: Code,
	cloud: Cloud,
	cpu: Cpu,
	database: Database,
	ellipsis: Ellipsis,
	'file-chart-column': FileChartColumn,
	'file-text': FileText,
	'external-link': ExternalLink,
	funnel: Funnel,
	gauge: Gauge,
	'hard-drive': HardDrive,
	gift: Gift,
	'git-branch': GitBranch,
	handshake: Handshake,
	info: Info,
	landmark: Landmark,
	layers: Layers,
	'layout-grid': LayoutGrid,
	library: Library,
	list: List,
	'message-square': MessageSquare,
	'memory-stick': MemoryStick,
	network: Network,
	package: Package,
	percent: Percent,
	receipt: Receipt,
	'refresh-cw': RefreshCw,
	repeat: Repeat,
	rocket: Rocket,
	'scroll-text': ScrollText,
	search: Search,
	server: Server,
	settings: Settings,
	'share-2': Share2,
	shield: Shield,
	'sliders-horizontal': SlidersHorizontal,
	'shield-alert': ShieldAlert,
	'shopping-cart': ShoppingCart,
	sparkles: Sparkles,
	star: Star,
	tag: Tag,
	'triangle-alert': TriangleAlert,
	truck: Truck,
	'undo-2': Undo2,
	users: Users,
	warehouse: Warehouse
} satisfies Record<string, Component>;

export type IconKey = keyof typeof ICONS;

/** Falls back to a neutral box so an unknown key degrades instead of crashing. */
export function icon(key: string): Component {
	return ICONS[key as IconKey] ?? Box;
}
