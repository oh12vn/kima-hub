import dotenv from "dotenv";
import { z } from "zod";
import { validateMusicConfig, MusicConfig } from "./utils/configValidator";
import { logger } from "./utils/logger";
import packageJson from "../package.json";

dotenv.config();

// Validate critical environment variables on startup
// MUSIC_PATH or MUSIC_PATHS (at least one must be provided)
const envSchema = z.object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    SESSION_SECRET: z
        .string()
        .min(32, "SESSION_SECRET must be at least 32 characters"),
    PORT: z.string().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).optional(),
});

try {
    envSchema.parse(process.env);
    // Ensure at least one music path is provided
    if (!process.env.MUSIC_PATH && !process.env.MUSIC_PATHS) {
        logger.error("MUSIC_PATH or MUSIC_PATHS is required");
        process.exit(1);
    }
    logger.debug("Environment variables validated");
} catch (error) {
    if (error instanceof z.ZodError) {
        logger.error(" Environment validation failed:");
        error.errors.forEach((err) => {
            logger.error(`   - ${err.path.join(".")}: ${err.message}`);
        });
        logger.error(
            "\n Please check your .env file and ensure all required variables are set."
        );
        process.exit(1);
    }
}

/**
 * Parse MUSIC_PATHS env var into an array of music root paths.
 *
 * Priority:
 * 1. MUSIC_PATHS=<comma-separated list> (e.g., "/music,/data")
 * 2. MUSIC_PATH=<single path> (backwards compatible)
 * 3. "/music" default
 */
function parseMusicPaths(): string[] {
    const raw = process.env.MUSIC_PATHS?.trim();
    if (raw) {
        return raw
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
    }
    // Fallback: treat MUSIC_PATH as single-item array
    const single = process.env.MUSIC_PATH?.trim();
    if (single) return [single];
    return ["/music"];
}

// Will be initialized async
let musicConfig: MusicConfig | null = null;

/** Get parsed music root paths (available immediately from env) */
export function getMusicPaths(): string[] {
    return musicConfig?.musicPaths ?? parseMusicPaths();
}

/** Get the primary music root (first path in MUSIC_PATHS) */
export function getPrimaryMusicPath(): string {
    return getMusicPaths()[0];
}

// Initialize music configuration asynchronously
export async function initializeMusicConfig() {
    try {
        musicConfig = await validateMusicConfig(getMusicPaths());
        logger.debug("Music configuration initialized");
    } catch (err: any) {
        logger.error(" Configuration validation failed:", err.message);
        logger.warn("   Using default/environment configuration");
        // Don't exit process - allow app to start for other features
        // Music features will fail gracefully if config is invalid
    }
}

export const APP_VERSION = packageJson.version;
export const USER_AGENT = `Kima/${APP_VERSION} (https://github.com/Chevron7Locked/kima-hub)`;

export const config = {
    version: APP_VERSION,
    port: parseInt(process.env.PORT || "3006", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    // DATABASE_URL and REDIS_URL are validated by envSchema above, so they're guaranteed to exist
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    sessionSecret: process.env.SESSION_SECRET!,

    // Music library configuration (self-contained native music system)
    // Access via config.music - will be updated after initialization
    get music(): MusicConfig {
        return musicConfig ?? {
            musicPaths: parseMusicPaths(),
            transcodeCachePath:
                process.env.TRANSCODE_CACHE_PATH || "./cache/transcodes",
            transcodeCacheMaxGb: parseInt(
                process.env.TRANSCODE_CACHE_MAX_GB || "10",
                10
            ),
        };
    },

    // Lidarr - now reads from database via lidarrService.ensureInitialized()
    lidarr:
        process.env.LIDARR_ENABLED === "true"
            ? {
                  url: process.env.LIDARR_URL!,
                  apiKey: process.env.LIDARR_API_KEY!,
                  enabled: true,
              }
            : undefined,

    // Last.fm
    lastfm: {
        apiKey: process.env.LASTFM_API_KEY || "c1797de6bf0b7e401b623118120cd9e1",
    },

    allowedOrigins:
        process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ||
        (process.env.NODE_ENV === "development" ? true : []),
};
