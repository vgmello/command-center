import { FixtureCatalogSource } from '../src/lib/server/catalog/fixture-source';

/**
 * Write `catalog.example.yaml` from the fixture catalog.
 *
 * Generated rather than hand-written, for the same reason the OpenAPI components are:
 * when two things describe one truth, one derives from the other. A hand-written example
 * would drift from the seeds the app actually runs on, and the first person to copy it
 * would get a file describing services that no longer exist.
 *
 * Run with `bun run catalog:example`.
 */

const catalog = new FixtureCatalogSource();
const domains = await catalog.listDomains();
const services = await catalog.listServices();

/** Quote anything YAML would otherwise read as something else. */
function scalar(value: string): string {
	return /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value) ? value : JSON.stringify(value);
}

const lines: string[] = [
	'# The service catalog.',
	'#',
	'# Generated from the fixture catalog by `bun run catalog:example` — edit the seeds,',
	'# not this file. Copy it somewhere, point CATALOG_FILE at the copy, and set',
	'# CATALOG_SOURCE=file.',
	'#',
	'# Everything here is DECLARED: what a service is, who owns it, where its runbook',
	'# lives. Nothing here is a reading — status, error rates and instance counts come',
	'# from the connected sources, and read "unknown" when nothing is watching.',
	'',
	'version: 1',
	'',
	'domains:'
];

for (const domain of domains) {
	lines.push(
		`  - slug: ${scalar(domain.slug)}`,
		`    name: ${scalar(domain.name)}`,
		`    shortName: ${scalar(domain.shortName)}`,
		`    owner: ${scalar(domain.owner)}`,
		`    criticality: ${domain.criticality}`,
		`    icon: ${domain.icon}`,
		`    accent: ${domain.accent}`
	);
}

lines.push('', 'services:');

for (const service of services) {
	lines.push(
		`  - slug: ${scalar(service.slug)}`,
		`    name: ${scalar(service.name)}`,
		`    domain: ${scalar(service.domainId)}`,
		`    description: ${scalar(service.description)}`,
		`    owner: ${scalar(service.owner)}`,
		`    type: ${scalar(service.serviceType)}`,
		`    language: ${scalar(service.language)}`,
		`    runtime: ${scalar(service.runtime)}`,
		`    icon: ${service.icon}`,
		`    accent: ${service.accent}`
	);

	const links: [string, string | undefined][] = [
		['repository', service.repository?.href],
		['chat', service.chatChannel?.href],
		['runbook', service.runbook?.href],
		['dashboard', service.dashboard?.href]
	];

	const present = links.filter(([, href]) => href);
	if (present.length > 0) {
		lines.push('    links:');
		for (const [key, href] of present) lines.push(`      ${key}: ${href}`);
	}

	// Written out even though every value equals the slug, because this is the field a
	// reader most needs to see exists — it is what makes "Show in Octopus" resolve when
	// a source names the service differently.
	lines.push(
		'    identity:',
		`      apm: ${scalar(service.slug)}`,
		`      deployment: ${scalar(service.slug)}`
	);
}

await Bun.write('catalog.example.yaml', lines.join('\n') + '\n');
console.log(`catalog.example.yaml — ${domains.length} domains, ${services.length} services`);
