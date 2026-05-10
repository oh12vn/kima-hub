import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";
import * as path from "path";
import { AppError, ErrorCode, ErrorCategory } from "./errors";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { getSystemSettings } from "./systemSettings";

const execAsync = promisify(exec);

export interface MusicConfig {
    musicPaths: string[];
    transcodeCachePath: string;
    transcodeCacheMaxGb: number;
}

function musicPathsFromEnv(): string[] {
    const raw = process.env.MUSIC_PATHS?.trim();
    if (raw) {
        return raw.split(",").map((p: string) => p.trim()).filter(Boolean);
    }
    const single = process.env.MUSIC_PATH?.trim();
    if (single) return [single];
    return ["/music"];
}

/**
 * Resolve effective music paths from env and system settings.
 * Env-vars (MUSIC_PATHS or MUSIC_PATH) take priority so Docker
 * deployments work without DB seeding. If neither env-var is set,
 * fall back to database musicPath, validated against container
 * visibility (Docker mount check).
 */
function resolveMusicPaths(dbMusicPath?: string): string[] {
    const envPaths = musicPathsFromEnv();
    const haveEnv = process.env.MUSIC_PATHS != null || process.env.MUSIC_PATH != null;
    if (haveEnv) return envPaths;
    // No env vars — use DB setting as single-item array
    return dbMusicPath ? [dbMusicPath] : ["/music"];
}

/**
 * Validate and load music configuration
 * @param providedMusicPaths - pre-resolved music roots from config.ts
 */
export async function validateMusicConfig(
    providedMusicPaths: string[]
): Promise<MusicConfig> {
    const settings = await getSystemSettings();

    // Re-resolve: providedMusicPaths come from env, but also check DB for info
    const dbMusicPath = settings?.musicPath;

    // Docker safety: If no paths exist but /music does, replace with /music
    const isDocker = fs.existsSync('/.dockerenv');
    const resolvedPaths = providedMusicPaths.length > 0
        ? providedMusicPaths
        : resolveMusicPaths(dbMusicPath);

    if (isDocker) {
        const anyExists = resolvedPaths.some((p) => fs.existsSync(p));
        if (!anyExists && fs.existsSync('/music')) {
            logger.warn(`None of MUSIC_PATHS=[${resolvedPaths}] found in container, using /music (Docker mount point)`);
            resolvedPaths.length = 0;
            resolvedPaths.push('/music');
        }
    }

    // Log DB vs env mismatch
    if (dbMusicPath && dbMusicPath !== resolvedPaths[0]) {
        logger.debug(`Database has musicPath=${dbMusicPath}, using ${resolvedPaths[0]} from env/default`);
    }

    // VALIDATE each music path exists and is readable
    const validPaths: string[] = [];
    for (const musicPath of resolvedPaths) {
        if (!fs.existsSync(musicPath)) {
            const isD = fs.existsSync('/.dockerenv') || process.env.NODE_ENV === 'production';
            const guidance = isD
                ? `Docker users: Ensure your volume mount is correct in docker-compose.yml:\n   volumes:\n     - /path/to/your/music:/music\n   The container expects music at /music, not your host path.`
                : `Check that MUSIC_PATH or MUSIC_PATHS in your .env file point to existing directories.`;
            throw new AppError(
                ErrorCode.MUSIC_PATH_NOT_ACCESSIBLE,
                ErrorCategory.FATAL,
                `Music path does not exist: ${musicPath}\n\n${guidance}`
            );
        }
        try {
            fs.accessSync(musicPath, fs.constants.R_OK);
            validPaths.push(musicPath);
        } catch {
            throw new AppError(
                ErrorCode.MUSIC_PATH_NOT_ACCESSIBLE,
                ErrorCategory.FATAL,
                `Music path not readable: ${musicPath}. Check file permissions.`
            );
        }
    }

    if (validPaths.length === 0) {
        throw new AppError(
            ErrorCode.MUSIC_PATH_NOT_ACCESSIBLE,
            ErrorCategory.FATAL,
            `No music paths available.`
        );
    }

    logger.debug(`Music paths validated: [${validPaths.join(', ')}]`);

    // Get transcode cache path
    const transcodeCachePath =
        process.env.TRANSCODE_CACHE_PATH ||
        path.join(process.cwd(), "cache", "transcodes");

    // VALIDATE TRANSCODE CACHE PATH
    if (!fs.existsSync(transcodeCachePath)) {
        try {
            fs.mkdirSync(transcodeCachePath, { recursive: true });
            logger.debug(
                `Created transcode cache directory: ${transcodeCachePath}`
            );
        } catch (err: any) {
            throw new AppError(
                ErrorCode.TRANSCODE_CACHE_NOT_WRITABLE,
                ErrorCategory.FATAL,
                `Cannot create transcode cache directory: ${transcodeCachePath}`,
                { originalError: err.message }
            );
        }
    }

    // Validate writable
    try {
        fs.accessSync(transcodeCachePath, fs.constants.W_OK);
    } catch {
        throw new AppError(
            ErrorCode.TRANSCODE_CACHE_NOT_WRITABLE,
            ErrorCategory.FATAL,
            `Transcode cache not writable: ${transcodeCachePath}. Check file permissions.`
        );
    }

    // Get cache size limit from SystemSettings or fallback to env/default
    const transcodeCacheMaxGb =
        settings?.transcodeCacheMaxGb ||
        parseInt(process.env.TRANSCODE_CACHE_MAX_GB || "10", 10);

    if (isNaN(transcodeCacheMaxGb) || transcodeCacheMaxGb < 1) {
        throw new AppError(
            ErrorCode.INVALID_CONFIG,
            ErrorCategory.FATAL,
            `Invalid transcode cache size: must be a positive integer. Got: ${transcodeCacheMaxGb}`
        );
    }

    // VALIDATE BUNDLED FFMPEG (from @ffmpeg-installer/ffmpeg)
    try {
        if (!fs.existsSync(ffmpegPath.path)) {
            throw new Error(`Bundled FFmpeg not found at: ${ffmpegPath.path}`);
        }
        const { stdout } = await execAsync(`"${ffmpegPath.path}" -version`);
        if (!stdout.includes("ffmpeg version")) {
            throw new Error("Invalid ffmpeg output");
        }
        logger.debug(`FFmpeg detected (bundled): ${stdout.split("\n")[0]}`);
        logger.debug(`   FFmpeg path: ${ffmpegPath.path}`);
    } catch (err: any) {
        logger.warn(
            "  Bundled FFmpeg not available. Transcoding will not be available."
        );
        logger.warn(`   Error: ${err.message}`);
        logger.warn("   Original quality streaming will still work.");
        // Don't throw - allow server to start without FFmpeg
    }

    logger.debug("Music configuration validated successfully");
    logger.debug(`   Music paths: ${validPaths.join(', ')}`);
    logger.debug(`   Transcode cache: ${transcodeCachePath}`);
    logger.debug(`   Cache limit: ${transcodeCacheMaxGb} GB`);

    return {
        musicPaths: validPaths,
        transcodeCachePath,
        transcodeCacheMaxGb,
    };
}
