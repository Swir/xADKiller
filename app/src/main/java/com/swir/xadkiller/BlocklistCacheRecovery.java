package com.swir.xadkiller;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Repairs the tiny crash window in the rollback-safe blocklist installer.
 *
 * updateRemote() validates a candidate before it renames the old cache to .bak and promotes
 * the new file. A process kill, reboot or power loss between those two renames can leave a
 * perfectly good .bak with no active remote_blocklist.txt. The .tmp file is never trusted on
 * startup because the interrupted run may not have completed validation.
 */
final class BlocklistCacheRecovery {
    private static final String CACHE_FILE = "remote_blocklist.txt";

    // Keep recovery aligned with BlocklistManager's production update gate. Recovery runs from
    // Application.onCreate(), so it must never rescan the entire 750k-entry ceiling on every
    // normal process start. We only need enough parser-valid unique domains to prove that a
    // rollback file is a meaningful protection source; fail closed if that evidence is not
    // reached inside these bounded scan windows.
    private static final int MIN_RECOVERY_DOMAINS = 1_000;
    static final int MAX_RECOVERY_SCAN_DOMAINS = 10_000;
    static final long MAX_RECOVERY_SCAN_BYTES = 4L * 1024L * 1024L;

    private BlocklistCacheRecovery() {}

    static boolean recover(Context context) {
        if (context == null) return false;
        try {
            File dir = context.getFilesDir();
            boolean restored = recoverFiles(
                    new File(dir, CACHE_FILE),
                    new File(dir, CACHE_FILE + ".bak"),
                    new File(dir, CACHE_FILE + ".tmp"));
            if (restored) {
                try {
                    SystemLogStore.info(context, "BLOCKLIST",
                            "Przywrócono ostatnią zweryfikowaną listę po przerwanym zapisie");
                } catch (Throwable ignored) {}
            }
            return restored;
        } catch (Throwable error) {
            try {
                SystemLogStore.error(context, "BLOCKLIST",
                        "Nie udało się sprawdzić odzyskiwania cache listy", error);
            } catch (Throwable ignored) {}
            return false;
        }
    }

    /** Package-private for deterministic JVM regression tests. */
    static boolean recoverFiles(File primary, File backup, File temporary) {
        if (primary == null || backup == null || temporary == null) return false;

        // The rollback file exists only inside/after the atomic-install recovery window. On the
        // overwhelmingly common path there is no .bak, so avoid parsing a large active cache on
        // the main application thread merely to rediscover that there is nothing to restore.
        if (!backup.exists()) {
            if (temporary.exists()) temporary.delete();
            return false;
        }

        boolean primaryHealthy = cacheLooksPlausible(primary);
        boolean backupHealthy = cacheLooksPlausible(backup);
        boolean restored = false;

        if (!primaryHealthy && backupHealthy) {
            // A truncated/non-domain primary must not win simply because it is non-empty.
            if (primary.exists() && !primary.delete()) return false;
            restored = backup.renameTo(primary);
            primaryHealthy = restored && cacheLooksPlausible(primary);
        }

        // A .tmp belongs to an interrupted download/install and has not necessarily passed
        // the unique-count/anti-shrink gate. Never promote it as protection data.
        if (temporary.exists()) temporary.delete();

        if (primaryHealthy) {
            // If both files survived, the active primary is the already-promoted verified
            // candidate. The older rollback copy is stale and can be discarded.
            if (backup.exists()) backup.delete();
        } else if (backup.exists()) {
            // Empty, malformed, duplicate-inflated, tiny or scan-budget-exhausting backups
            // cannot be a known-good protection source and should not be retried forever.
            backup.delete();
        }

        return restored;
    }

    /**
     * Recovery validation deliberately reuses the production domain parser. Both accepted-domain
     * count and bytes read are bounded. The byte ceiling is important because an interrupted or
     * corrupted backup can contain a very long prefix of comments/garbage before any valid domain;
     * without it, Application.onCreate() could spend unbounded time scanning a huge file even though
     * the semantic domain cap is only 10k. Exhausting the byte budget fails closed.
     */
    static boolean cacheLooksPlausible(File file) {
        if (file == null || !file.isFile() || file.length() <= 0L) return false;
        try (InputStream raw = new FileInputStream(file);
             InputStream bounded = BlocklistManager.boundedRemoteInput(raw, MAX_RECOVERY_SCAN_BYTES)) {
            return BlocklistManager.countUniqueNormalized(bounded, MAX_RECOVERY_SCAN_DOMAINS)
                    >= MIN_RECOVERY_DOMAINS;
        } catch (IOException | RuntimeException error) {
            return false;
        }
    }
}
