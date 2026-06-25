interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_SHORT_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
