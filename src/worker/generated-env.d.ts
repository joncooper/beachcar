/* eslint-disable */
// Starter Env bindings. Regenerate with `npm run cf:types` after updating wrangler.jsonc.
interface __BaseEnv_Env {
	BeachcarAgent: DurableObjectNamespace<import("./agents/beachcar-agent").BeachcarAgent>;
	BEACHCAR_RUNNER_CONTAINER: DurableObjectNamespace<import("./containers/beachcar-runner-container").BeachcarRunnerContainer>;
	BEACHCAR_RUN_WORKFLOW: Workflow<import("./workflows/beachcar-run-workflow").BeachcarRunWorkflowParams>;
	IMAGES: R2Bucket;
	DB: D1Database;
	ASSETS: Fetcher;
	ALLOWED_EMAIL: string;
	ENVIRONMENT: string;
	PUBLISH_TOKEN?: string;
	CLERK_SECRET_KEY?: string;
	CLERK_JWT_ISSUER?: string;
	TEAM_DOMAIN?: string;
	POLICY_AUD?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	BEACHCAR_AI_GATEWAY_TOKEN?: string;
	BEACHCAR_AI_GATEWAY_BASE_URL?: string;
	BEACHCAR_AI_GATEWAY_ID?: string;
	BEACHCAR_AI_GATEWAY_MODEL?: string;
	BEACHCAR_AI_ESTIMATED_MICROS_PER_1K_TOKENS?: string;
	BEACHCAR_RUNNER_MODE?: string;
	BEACHCAR_CODEX_MODEL?: string;
	OPENAI_API_KEY?: string;
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./index");
		durableNamespaces: "BeachcarAgent" | "BeachcarRunnerContainer";
	}
	interface Env extends __BaseEnv_Env {}
}
interface Env extends __BaseEnv_Env {}
type StringifyValues<EnvType extends Record<string, unknown>> = {
	[Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
	interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "ALLOWED_EMAIL" | "ENVIRONMENT" | "PUBLISH_TOKEN">> {}
}
