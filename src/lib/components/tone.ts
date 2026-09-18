import type {
	DeploymentStatus,
	DomainAccent,
	HealthStatus,
	IncidentSeverity,
	ToneKey
} from '$lib/platform/types';

/**
 * Status vocabulary → Tailwind classes.
 *
 * The single crossing point between operational meaning and colour. Components
 * ask for `statusTone('degraded')`, never for amber; swapping the palette is
 * then a change to the theme tokens plus this file, and nothing else.
 *
 * Classes are written out in full rather than composed from a template string,
 * because Tailwind only ships classes it can see literally in the source.
 */
export interface Tone {
	/** Foreground text and icon colour. */
	text: string;
	/** Tinted chip background plus matching border, for badges and icon tiles. */
	chip: string;
	/** Solid fill, for status dots. */
	dot: string;
	/** SVG stroke, for rings and sparklines. */
	stroke: string;
	/** SVG fill, for donut segments and sparkline areas. */
	fill: string;
}

const STATUS_TONES: Record<HealthStatus, Tone> = {
	healthy: {
		text: 'text-healthy',
		chip: 'bg-healthy/12 text-healthy border-healthy/25',
		dot: 'bg-healthy',
		stroke: 'stroke-healthy',
		fill: 'fill-healthy'
	},
	degraded: {
		text: 'text-degraded',
		chip: 'bg-degraded/12 text-degraded border-degraded/25',
		dot: 'bg-degraded',
		stroke: 'stroke-degraded',
		fill: 'fill-degraded'
	},
	down: {
		text: 'text-down',
		chip: 'bg-down/12 text-down border-down/25',
		dot: 'bg-down',
		stroke: 'stroke-down',
		fill: 'fill-down'
	},
	unknown: {
		text: 'text-unknown',
		chip: 'bg-unknown/12 text-unknown border-unknown/25',
		dot: 'bg-unknown',
		stroke: 'stroke-unknown',
		fill: 'fill-unknown'
	}
};

export function statusTone(status: HealthStatus): Tone {
	return STATUS_TONES[status];
}

/** Blue: in flight, or informational. Not a health state, so not in `STATUS_TONES`. */
const INFO_TONE: Tone = {
	text: 'text-info',
	chip: 'bg-info/12 text-info border-info/25',
	dot: 'bg-info',
	stroke: 'stroke-info',
	fill: 'fill-info'
};

/** The full vocabulary a tile or badge can ask for. */
export function toneFor(key: ToneKey): Tone {
	return key === 'info' ? INFO_TONE : STATUS_TONES[key];
}

/** Incident severity reuses the status palette: critical reads as down, and so on. */
const SEVERITY_STATUS: Record<IncidentSeverity, HealthStatus> = {
	critical: 'down',
	warning: 'degraded',
	info: 'unknown'
};

export function severityTone(severity: IncidentSeverity): Tone {
	if (severity === 'info') return INFO_TONE;
	return STATUS_TONES[SEVERITY_STATUS[severity]];
}

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
	critical: 'Critical',
	warning: 'Warning',
	info: 'Info'
};

const DEPLOYMENT_TONES: Record<DeploymentStatus, ToneKey> = {
	success: 'healthy',
	failed: 'down',
	// Blue rather than grey: a run in flight is a known state, just not a finished one.
	'in-progress': 'info',
	'rolled-back': 'degraded'
};

export function deploymentTone(status: DeploymentStatus): Tone {
	return toneFor(DEPLOYMENT_TONES[status]);
}

/**
 * Icon key per deployment outcome.
 *
 * Here rather than in a component for the same reason the colours are: this is the
 * one crossing point between what a status means and how it is drawn, so a screen
 * cannot pair a green tint with a cross.
 */
export const DEPLOYMENT_ICONS: Record<DeploymentStatus, string> = {
	success: 'circle-check',
	failed: 'circle-x',
	'in-progress': 'refresh-cw',
	'rolled-back': 'undo-2'
};

export const DEPLOYMENT_LABELS: Record<DeploymentStatus, string> = {
	success: 'Success',
	failed: 'Failed',
	'in-progress': 'Running',
	'rolled-back': 'Rolled back'
};

/**
 * Identity tints for domain icon tiles.
 *
 * Separate from the status palette on purpose — this is the domain's colour,
 * not a reading of its health, and the two must not be confusable.
 */
const ACCENT_TILES: Record<DomainAccent, string> = {
	blue: 'bg-info/12 text-info ring-info/20',
	green: 'bg-healthy/12 text-healthy ring-healthy/20',
	amber: 'bg-degraded/12 text-degraded ring-degraded/20',
	red: 'bg-down/12 text-down ring-down/20',
	violet: 'bg-violet-500/12 text-violet-400 ring-violet-500/20',
	slate: 'bg-muted text-muted-foreground ring-border'
};

export function accentTile(accent: DomainAccent): string {
	return ACCENT_TILES[accent];
}

/**
 * The same identity tints as solid marks, for charts.
 *
 * Written out in full beside the tiles rather than composed from them, because
 * Tailwind only ships classes it can see literally in the source — a template string
 * would produce class names that exist in the markup and in no stylesheet.
 */
const ACCENT_STROKES: Record<DomainAccent, string> = {
	blue: 'stroke-info',
	green: 'stroke-healthy',
	amber: 'stroke-degraded',
	red: 'stroke-down',
	violet: 'stroke-violet-400',
	slate: 'stroke-unknown'
};

const ACCENT_DOTS: Record<DomainAccent, string> = {
	blue: 'bg-info',
	green: 'bg-healthy',
	amber: 'bg-degraded',
	red: 'bg-down',
	violet: 'bg-violet-400',
	slate: 'bg-unknown'
};

export function accentStroke(accent: DomainAccent): string {
	return ACCENT_STROKES[accent];
}

export function accentDot(accent: DomainAccent): string {
	return ACCENT_DOTS[accent];
}

/** Trend sentiment → colour. Neutral stays muted so it does not compete. */
export function sentimentText(sentiment: 'good' | 'bad' | 'neutral'): string {
	if (sentiment === 'good') return 'text-healthy';
	if (sentiment === 'bad') return 'text-down';
	return 'text-muted-foreground';
}

export function sentimentStroke(sentiment: 'good' | 'bad' | 'neutral'): string {
	if (sentiment === 'good') return 'stroke-healthy';
	if (sentiment === 'bad') return 'stroke-down';
	return 'stroke-info';
}
