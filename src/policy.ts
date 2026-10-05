export const MEDIA_EXTENSIONS = new Set([
  ".osv",
  ".mp4",
  ".mov",
  ".m4v",
  ".lrv",
  ".thm",
  ".lrf",
  ".insv",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".dng",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".m4a",
  ".mp3",
  ".wav",
  ".aac",
]);

export const INTERESTING_EXTENSIONS = new Set([
  ".json",
  ".plist",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".ini",
  ".xml",
  ".meta",
  ".proj",
  ".pb",
  ".protobuf",
  ".txt",
  ".manifest",
]);

/** Directories that are large caches or logs. Discovery does not enter them. */
export const SKIP_DIRECTORY_NAMES = new Set([
  "cache",
  "media_cache",
  "crash",
  "log",
  "logs",
  "perfetto",
  "tracking_log",
  "ml_kmsg",
  "node_modules",
  ".git",
]);

/**
 * Directories that are numerous but not the project document.
 * Discovery summarizes their immediate children instead of listing every file.
 */
export const SUMMARIZE_DIRECTORY_NAMES = new Set([
  "bookmark",
  "meta_shot",
  "meta_data",
  "resources",
  "audio",
  "dashboard",
  "effect",
  "transition",
  "camera_movement",
  "filter",
  "__MACOSX",
  "agency",
  "compose",
  "cloud_album",
  "media_highlight",
  "exportlog",
]);

export const JSON_PARSE_LIMIT_BYTES = 20 * 1024 * 1024;
export const HEADER_BYTES = 512;
