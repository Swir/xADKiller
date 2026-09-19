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
    // reached inside this bounded scan window.
    private static final int MIN_RECOVERY_DOMAINS = 1_000;
    static final int MAX_RECOVERY_SCAN_DOMAINS = 10_000;

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
            // Empty, malformed, duplicate-inflated or tiny backups cannot be a known-good
            // protection source and should not be retried forever on every process start.
            backup.delete();
        }

        return restored;
    }

    /**
     * Recovery validation deliberately reuses the production domain parser. This prevents a
     * non-empty HTML/error/truncated file or duplicate-inflated payload from being restored as
     * known-good protection after a crash while keeping cold-start work strictly bounded.
     */
    static boolean cacheLooksPlausible(File file) {
        if (file == null || !file.isFile() || file.length() <= 0L) return false;
        try (InputStream input = new FileInputStream(file)) {
            return BlocklistManager.countUniqueNormalized(input, MAX_RECOVERY_SCAN_DOMAINS)
                    >= MIN_RECOVERY_DOMAINS;
        } catch (IOException | RuntimeException error) {
            return false;
        }
    }
}
