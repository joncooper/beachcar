/* eslint-disable */
// Starter Env bindings. Regenerate with `npm run cf:types` after updating wrangler.jsonc.
interface __BaseEnv_Env {
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
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./index");
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
