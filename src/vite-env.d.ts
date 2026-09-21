/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the API lives, for builds that have no origin of their own.
   *
   * Only read by the phone app; a web build ignores it and talks to whatever
   * host served it. Set in `.env.production` or on the build machine.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  /** Absent outside Vite — a test or a script has no env at all. */
  readonly env: ImportMetaEnv;
}
