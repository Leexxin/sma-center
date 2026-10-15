declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    SMA_CENTER_ADMIN_EMAILS?: string;
    /** Legacy deployments remain compatible. */
    ATLAS_ADMIN_EMAILS?: string;
    SMA_CREDENTIAL_KEY?: string;
  }
}
