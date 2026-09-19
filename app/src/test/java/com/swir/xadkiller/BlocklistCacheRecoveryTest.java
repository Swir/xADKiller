package com.swir.xadkiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import org.junit.Test;

public class BlocklistCacheRecoveryTest {
    private static void write(File file, String value) throws Exception {
        Files.writeString(file.toPath(), value, StandardCharsets.UTF_8);
    }

    @Test public void restoresVerifiedBackupWhenPrimaryIsMissing() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-recovery").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(backup, "ads.example\ntracker.example\n");
        write(temporary, "unverified.example\n");

        assertTrue(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertTrue(primary.isFile());
        assertEquals("ads.example\ntracker.example\n", Files.readString(primary.toPath(), StandardCharsets.UTF_8));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void keepsPromotedPrimaryAndRemovesStaleRollbackFiles() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-primary").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(primary, "new-verified.example\n");
        write(backup, "old-verified.example\n");
        write(temporary, "interrupted-next-update.example\n");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertEquals("new-verified.example\n", Files.readString(primary.toPath(), StandardCharsets.UTF_8));
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void neverPromotesTemporaryCandidateWithoutKnownGoodBackup() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-temp").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(temporary, "candidate-not-yet-validated.example\n");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
        assertFalse(temporary.exists());
    }

    @Test public void emptyBackupCannotBecomeProtectionData() throws Exception {
        File dir = Files.createTempDirectory("xad-cache-empty").toFile();
        File primary = new File(dir, "remote_blocklist.txt");
        File backup = new File(dir, "remote_blocklist.txt.bak");
        File temporary = new File(dir, "remote_blocklist.txt.tmp");
        write(backup, "");

        assertFalse(BlocklistCacheRecovery.recoverFiles(primary, backup, temporary));
        assertFalse(primary.exists());
        assertFalse(backup.exists());
    }
}
