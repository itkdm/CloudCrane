/** Shared publisher/consumer limits for immutable template artifacts. */
export const TEMPLATE_ARTIFACT_MAX_BYTES = 500 * 1024 * 1024;
export const TEMPLATE_ARTIFACT_EXPANDED_MAX_BYTES = 1024 * 1024 * 1024;
export const TEMPLATE_ARTIFACT_FILE_MAX_BYTES = 100 * 1024 * 1024;
// ZIP comments may be up to 65,535 bytes; unzipper's default 80-byte tail
// window rejects otherwise valid archives with longer comments.
export const ZIP_DIRECTORY_TAIL_BYTES = 128 * 1024;
