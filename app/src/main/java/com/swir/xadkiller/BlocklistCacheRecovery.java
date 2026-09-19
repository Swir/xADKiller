package com.swir.xadkiller;

import android.content.Context;

import java.io.File;

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

        boolean primaryHealthy = primary.isFile() && primary.length() > 0L;
        boolean backupHealthy = backup.isFile() && backup.length() > 0L;
        boolean restored = false;

        if (!primaryHealthy && backupHealthy) {
            if (primary.exists() && !primary.delete()) return false;
            restored = backup.renameTo(primary);
            primaryHealthy = restored && primary.isFile() && primary.length() > 0L;
        }

        // A .tmp belongs to an interrupted download/install and has not necessarily passed
        // the unique-count/anti-shrink gate. Never promote it as protection data.
        if (temporary.exists()) temporary.delete();

        if (primaryHealthy) {
            // If both files survived, the active primary is the already-promoted verified
            // candidate. The older rollback copy is stale and can be discarded.
            if (backup.exists()) backup.delete();
        } else if (backup.exists() && backup.length() <= 0L) {
            // Empty backups cannot be a known-good protection source.
            backup.delete();
        }

        return restored;
    }
}
