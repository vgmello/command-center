import type {
	DeploymentStatus,
	DomainAccent,
	HealthStatus,
	IncidentSeverity
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

/** Incident severity reuses the status palette: critical reads as down, and so on. */
const SEVERITY_STATUS: Record<IncidentSeverity, HealthStatus> = {
	critical: 'down',
	warning: 'degraded',
	info: 'unknown'
};

export function severityTone(severity: IncidentSeverity): Tone {
	if (severity === 'info') {
		return {
			text: 'text-info',
			chip: 'bg-info/12 text-info border-info/25',
			dot: 'bg-info',
			stroke: 'stroke-info',
			fill: 'fill-info'
		};
	}
	return STATUS_TONES[SEVERITY_STATUS[severity]];
}

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
	critical: 'Critical',
	warning: 'Warning',
	info: 'Info'
};

const DEPLOYMENT_STATUS: Record<DeploymentStatus, HealthStatus> = {
	success: 'healthy',
	failed: 'down',
	'in-progress': 'unknown',
	'rolled-back': 'degraded'
};

export function deploymentTone(status: DeploymentStatus): Tone {
	return STATUS_TONES[DEPLOYMENT_STATUS[status]];
}

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
