import { toJsonSchemaDefs } from '@valibot/to-json-schema';
import {
	deploymentSchema,
	domainPageSchema,
	domainRefSchema,
	domainSchema,
	domainSummarySchema,
	errorSchema,
	incidentSchema,
	infrastructureSchema,
	metricSchema,
	pageSchema,
	systemStatusSchema
} from './dto';
import { DEFAULT_API_PAGE_SIZE } from '../schemas';
import { DOMAIN_SORT_KEYS, DOMAIN_STATUS_FILTERS } from '$lib/platform/query';

/**
 * The published OpenAPI 3.1 document.
 *
 * Generated from the same Valibot schemas the endpoints validate and serialise with,
 * so the documentation cannot describe a payload the API does not send. A spec
 * maintained by hand beside the code is a spec that is wrong within a month.
 *
 * The paths are declared here rather than derived from the filesystem: SvelteKit
 * knows the routes, but only this file knows which of them are part of the *contract*.
 * A new `+server.ts` should not become public API by existing.
 */

const schemas = toJsonSchemaDefs({
	Domain: domainSchema,
	DomainRef: domainRefSchema,
	Page: pageSchema,
	DomainPage: domainPageSchema,
	DomainSummary: domainSummarySchema,
	Metric: metricSchema,
	Incident: incidentSchema,
	Deployment: deploymentSchema,
	Infrastructure: infrastructureSchema,
	SystemStatus: systemStatusSchema,
	Error: errorSchema
});

const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });

/** Every endpoint is scoped to an environment and a lookback window. */
const scopeParameters = [
	{
		name: 'environment',
		in: 'query',
		required: false,
		schema: {
			type: 'string',
			enum: ['production', 'staging', 'development'],
			default: 'production'
		},
		description: 'Deployment target to report on.'
	},
	{
		name: 'timeRange',
		in: 'query',
		required: false,
		schema: { type: 'string', enum: ['5m', '15m', '1h', '6h', '24h', '7d'], default: '15m' },
		description: 'Lookback window for every metric and trend in the response.'
	}
];

const limitParameter = (max: number, fallback: number) => ({
	name: 'limit',
	in: 'query',
	required: false,
	schema: { type: 'integer', minimum: 1, maximum: max, default: fallback },
	description: 'Maximum number of records to return.'
});

/** The standard responses every endpoint can produce. */
const commonResponses = {
	'400': {
		description: 'The request could not be parsed or failed validation.',
		content: { 'application/json': { schema: ref('Error') } }
	},
	'401': { description: 'Missing or invalid bearer token.' }
};

function collection(name: keyof typeof schemas) {
	return {
		type: 'object',
		required: ['data'],
		properties: { data: { type: 'array', items: ref(name) } }
	};
}

function operation(config: {
	summary: string;
	description: string;
	operationId: string;
	tag: string;
	parameters?: unknown[];
	schema: unknown;
}) {
	return {
		get: {
			summary: config.summary,
			description: config.description,
			operationId: config.operationId,
			tags: [config.tag],
			parameters: [...scopeParameters, ...(config.parameters ?? [])],
			responses: {
				'200': {
					description: 'OK',
					content: { 'application/json': { schema: config.schema } }
				},
				...commonResponses
			}
		}
	};
}

export function openApiDocument(origin: string) {
	return {
		openapi: '3.1.0',
		info: {
			title: 'Command Center API',
			version: '1.0.0',
			description:
				'Read access to platform health: domains, headline metrics, incidents, ' +
				'deployments and infrastructure.\n\n' +
				'Every endpoint is scoped by `environment` and `timeRange`, and every response ' +
				'is a fact rather than a rendering — statuses and units are returned, never ' +
				'colours or pre-formatted strings.\n\n' +
				'Authenticate with `Authorization: Bearer <token>`. Tokens are issued out of band.'
		},
		servers: [{ url: origin, description: 'This deployment' }],
		security: [{ bearerAuth: [] }],
		tags: [
			{ name: 'Domains', description: 'Business domains and their rolled-up health.' },
			{ name: 'Metrics', description: 'Headline rates across the platform.' },
			{ name: 'Activity', description: 'Incidents and deployments.' },
			{ name: 'Infrastructure', description: 'Clusters, nodes, databases and queues.' }
		],
		paths: {
			'/api/v1/domains': operation({
				summary: 'List domains',
				description:
					'Filtering, sorting and paging are applied by the data source, so a large ' +
					'platform never materialises more than one page.',
				operationId: 'listDomains',
				tag: 'Domains',
				parameters: [
					{
						name: 'search',
						in: 'query',
						required: false,
						schema: { type: 'string', maxLength: 120 },
						description: 'Case-insensitive match on domain name or id.'
					},
					{
						name: 'status',
						in: 'query',
						required: false,
						schema: { type: 'string', enum: [...DOMAIN_STATUS_FILTERS], default: 'all' }
					},
					{
						name: 'sort',
						in: 'query',
						required: false,
						schema: { type: 'string', enum: [...DOMAIN_SORT_KEYS], default: 'health-score' },
						description:
							'`health-score` orders by criticality tier first, then by the worst score ' +
							'within the tier.'
					},
					{
						name: 'page',
						in: 'query',
						required: false,
						schema: { type: 'integer', minimum: 1, default: 1 }
					},
					{
						name: 'pageSize',
						in: 'query',
						required: false,
						schema: { type: 'integer', minimum: 1, maximum: 100, default: DEFAULT_API_PAGE_SIZE }
					}
				],
				schema: ref('DomainPage')
			}),
			'/api/v1/domains/summary': operation({
				summary: 'Count domains by status',
				description: 'An aggregate, answered without returning the domains themselves.',
				operationId: 'getDomainSummary',
				tag: 'Domains',
				schema: ref('DomainSummary')
			}),
			'/api/v1/metrics': operation({
				summary: 'Read headline metrics',
				description:
					'Raw observed values. `kind` says what the number is and `polarity` says ' +
					'whether an increase is good news — neither is inferable from the value.',
				operationId: 'listMetrics',
				tag: 'Metrics',
				schema: collection('Metric')
			}),
			'/api/v1/incidents': operation({
				summary: 'List active incidents',
				description: 'Ordered by severity, then most recently opened.',
				operationId: 'listIncidents',
				tag: 'Activity',
				parameters: [limitParameter(100, 20)],
				schema: collection('Incident')
			}),
			'/api/v1/deployments': operation({
				summary: 'List recent deployments',
				description: 'Newest first.',
				operationId: 'listDeployments',
				tag: 'Activity',
				parameters: [limitParameter(100, 20)],
				schema: collection('Deployment')
			}),
			'/api/v1/infrastructure': operation({
				summary: 'Summarise infrastructure',
				description: 'Counts by kind, with the rolled-up status of each.',
				operationId: 'listInfrastructure',
				tag: 'Infrastructure',
				schema: collection('Infrastructure')
			}),
			'/api/v1/status': operation({
				summary: 'Read platform status',
				description: 'The single roll-up: worst state wins.',
				operationId: 'getSystemStatus',
				tag: 'Domains',
				schema: ref('SystemStatus')
			})
		},
		components: {
			securitySchemes: {
				bearerAuth: { type: 'http', scheme: 'bearer', description: 'A token from `API_TOKENS`.' }
			},
			schemas
		}
	};
}
