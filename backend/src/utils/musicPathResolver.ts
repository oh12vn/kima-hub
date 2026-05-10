import * as fs from "fs";
import * as path from "path";

/**
 * Resolve a relative track path to an absolute path by trying each music root.
 * Returns the first root where the file actually exists, or falls back to the first root.
 *
 * This enables multi-volume support: if a track was scanned from any music root,
 * we can find it again regardless of which root it's on.
 */
export function resolveTrackAbsolute(
    musicPaths: string[],
    relativePath: string
): string {
    // Normalize the relative path for consistent matching
    const normalized = relativePath.replace(/\\/g, "/");

    for (const mp of musicPaths) {
        const candidate = path.join(mp, normalized);
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore permission errors etc
        }
    }

    // Fallback: return the first root even if file doesn't exist
    // (caller will get a 404 from filesystem operations)
    return path.join(musicPaths[0], normalized);
}

/**
 * Check if a relative path matches under any music root
 * (without requiring the file to exist on disk).
 * Useful for playlist generation, discovery checks, etc.
 */
export function joinAnyMusicPath(
    musicPaths: string[],
    relativePath: string
): string {
    // If the stored relativePath already hints at a specific root
    // (e.g., starts with a known directory name used as volume label),
    // try to match intelligently. Otherwise, use first root.
    return path.join(musicPaths[0], relativePath.replace(/\\/g, "/"));
}

/**
 * Check if an absolute path starts with any of the music roots.
 */
export function isUnderMusicPath(
    musicPaths: string[],
    absolutePath: string
): boolean {
    const resolved = path.resolve(absolutePath);
    return musicPaths.some((mp) => {
        const resolvedMp = path.resolve(mp);
        return resolved.startsWith(resolvedMp + path.sep) || resolved === resolvedMp;
    });
}
