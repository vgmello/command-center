import { toJsonSchemaDefs } from '@valibot/to-json-schema';
import {
	activitySummarySchema,
	dependenciesSchema,
	deploymentPageSchema,
	deploymentSchema,
	deploymentSummarySchema,
	domainChangeSchema,
	endpointSchema,
	facetSchema,
	notFoundSchema,
	healthCheckSchema,
	serviceSchema,
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
import { ALL_OWNERS, DOMAIN_SORT_KEYS, DOMAIN_STATUS_FILTERS } from '$lib/platform/query';
import {
	ALL_DOMAINS,
	ALL_ENVIRONMENTS,
	ALL_SERVICES,
	DEPLOYMENT_STATES,
	DEPLOYMENT_WINDOWS
} from '$lib/platform/deployments';

/**
 * The reusable half of the OpenAPI document: schemas, parameters, security.
 *
 * Generated from the same Valibot schemas the endpoints validate and serialise with,
 * so the documentation cannot describe a payload the API does not send. A response
 * schema written by hand beside the code is a schema that is wrong within a month —
 * and the constraints go first, because nobody remembers to update a `maximum`.
 *
 * The other half — which paths exist, what each one is for — lives in `@swagger`
 * JSDoc next to each handler, where `sveltekit-openapi-generator` picks it up. This
 * file is serialised to `components.yaml` by `bun run openapi:components` and merged
 * in by that plugin.
 *
 * Split this way on purpose: prose belongs next to the code it describes, and
 * schemas belong wherever they are already defined once.
 */

const schemas = toJsonSchemaDefs(
	{
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
		DeploymentPage: deploymentPageSchema,
		DeploymentSummary: deploymentSummarySchema,
		ActivitySummary: activitySummarySchema,
		Facet: facetSchema,
		DomainChange: domainChangeSchema,
		Service: serviceSchema,
		HealthCheck: healthCheckSchema,
		Dependencies: dependenciesSchema,
		Endpoint: endpointSchema,
		Error: errorSchema,
		NotFoundError: notFoundSchema
	},
	{
		/**
		 * Point cross-schema references at where they actually land.
		 *
		 * `toJsonSchemaDefs` writes plain JSON Schema, so it emits `#/$defs/Domain`.
		 * These definitions are merged into `components.schemas`, where that pointer
		 * resolves to nothing: Scalar logs "invalid reference" and a generated client
		 * would produce an untyped hole wherever one schema embeds another.
		 *
		 * Despite the doc comment saying it returns a reference *ID*, the return value
		 * is assigned straight to `$ref` (`convertSchema`, index.mjs) — so it is the
		 * whole pointer, and the prefix belongs here.
		 */
		overrideRef: ({ referenceId }) => `#/components/schemas/${referenceId}`
	}
);

/** Scope parameters every endpoint accepts, referenced from the JSDoc blocks. */
const parameters = {
	Environment: {
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
	TimeRange: {
		name: 'timeRange',
		in: 'query',
		required: false,
		schema: {
			type: 'string',
			enum: ['5m', '15m', '1h', '6h', '24h', '7d'],
			default: '15m'
		},
		description: 'Lookback window for every metric and trend in the response.'
	},
	Limit: {
		name: 'limit',
		in: 'query',
		required: false,
		schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
		description: 'Maximum number of records to return.'
	},
	Search: {
		name: 'search',
		in: 'query',
		required: false,
		schema: { type: 'string', maxLength: 120 },
		description: 'Case-insensitive match on domain name or id.'
	},
	DomainStatus: {
		name: 'status',
		in: 'query',
		required: false,
		schema: { type: 'string', enum: [...DOMAIN_STATUS_FILTERS], default: 'all' }
	},
	DomainOwner: {
		name: 'owner',
		in: 'query',
		required: false,
		schema: { type: 'string', maxLength: 120, default: ALL_OWNERS },
		description:
			'An owner handle, or `all`. Owners are org data rather than a fixed set — read the current list from the domains they own.'
	},
	DeploymentState: {
		name: 'state',
		in: 'query',
		required: false,
		schema: { type: 'string', enum: [...DEPLOYMENT_STATES], default: 'all' },
		description:
			'Which outcomes to include. `completed` covers everything that finished, which is a success or a rollback.'
	},
	DeploymentDomain: {
		name: 'domain',
		in: 'query',
		required: false,
		schema: { type: 'string', maxLength: 120, default: ALL_DOMAINS },
		description: 'A domain id, or `all`.'
	},
	DeploymentService: {
		name: 'service',
		in: 'query',
		required: false,
		schema: { type: 'string', maxLength: 120, default: ALL_SERVICES },
		description:
			'An exact service name, or `all`. Exact rather than a substring, so a service is not matched by a longer name containing it.'
	},
	DeployedTo: {
		name: 'deployedTo',
		in: 'query',
		required: false,
		schema: {
			type: 'string',
			enum: ['production', 'staging', 'development', ALL_ENVIRONMENTS],
			default: ALL_ENVIRONMENTS
		},
		description:
			'The environment a run targeted. A different axis from the `environment` scope parameter, which says what the platform view reports on — hence the separate name rather than a second `environment` key.'
	},
	DeploymentWindow: {
		name: 'window',
		in: 'query',
		required: false,
		schema: { type: 'string', enum: [...DEPLOYMENT_WINDOWS], default: 'any' },
		description: 'How far back to look. `any` applies no bound.'
	},
	ServiceSlug: {
		name: 'slug',
		in: 'path',
		required: true,
		schema: { type: 'string', maxLength: 120, pattern: '^[a-z0-9][a-z0-9-]*$' },
		description: 'The service identifier, as returned by the services collection.'
	},
	DomainSort: {
		name: 'sort',
		in: 'query',
		required: false,
		schema: { type: 'string', enum: [...DOMAIN_SORT_KEYS], default: 'health-score' },
		description:
			'`health-score` orders by criticality tier first, then by the worst score within the tier.'
	},
	Page: {
		name: 'page',
		in: 'query',
		required: false,
		schema: { type: 'integer', minimum: 1, default: 1 }
	},
	PageSize: {
		name: 'pageSize',
		in: 'query',
		required: false,
		schema: { type: 'integer', minimum: 1, maximum: 100, default: DEFAULT_API_PAGE_SIZE }
	}
};

/** Responses shared by every operation, so no JSDoc block restates them. */
const responses = {
	BadRequest: {
		description: 'The request could not be parsed or failed validation.',
		content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
	},
	Unauthorized: { description: 'Missing or invalid bearer token.' },
	NotFound: {
		description: 'No resource with that identifier.',
		content: { 'application/json': { schema: { $ref: '#/components/schemas/NotFoundError' } } }
	}
};

const securitySchemes = {
	bearerAuth: {
		type: 'http',
		scheme: 'bearer',
		description: 'A token from `API_TOKENS`.'
	}
};

/** The whole reusable block, exactly as it is written to `components.yaml`. */
export function openApiComponents() {
	return { components: { schemas, parameters, responses, securitySchemes } };
}
